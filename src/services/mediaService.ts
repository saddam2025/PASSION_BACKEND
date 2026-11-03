import { randomBytes, randomUUID } from 'node:crypto';
import { fromBuffer } from 'file-type';
import mongoose, { type ClientSession } from 'mongoose';
import sharp from 'sharp';
import type pino from 'pino';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { Media } from '../models/Media';
import { AuditLog } from '../models/AuditLog';
import type { MediaListQuery } from '../shared/schemas/media';
import type { AuthActor } from '../types/express';
import type { StorageDriver } from './storageDriver';
import { writeAudit } from './audit';
import { hasPermission as roleHasPermission } from '../shared/schemas/permissions';

const MAX_PIXELS = 40_000_000;
const IMAGE_MAX = 5 * 1024 * 1024;
const RECEIPT_MAX = 8 * 1024 * 1024;
type UploadFile = { buffer: Buffer; originalname: string; size: number };
type MediaRecordProjection = { _id: mongoose.Types.ObjectId; key: string; variants?: Array<{ name?: string; key: string }>; width?: number | null; height?: number | null; mime: string; size: number; createdAt?: Date };
function requireImageAccess(actor: AuthActor) {
  if (actor.role !== 'admin') throw new ForbiddenError('مكتبة الوسائط متاحة للمسؤول بس.');
}
function objectId(value: string) {
  if (!mongoose.isValidObjectId(value)) throw new NotFoundError('الملف ده مش موجود.');
  return new mongoose.Types.ObjectId(value);
}
function uploadName(name: string) { return [...name].filter((character) => { const code = character.charCodeAt(0); return code >= 32 && code !== 127 && character !== '/' && character !== '\\'; }).join('').trim().slice(0, 160) || 'ملف'; }
function monthPath(now = new Date()) { return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`; }
function hasPaymentPermission(actor: AuthActor) { return roleHasPermission(actor, 'viewPayments'); }
function hasRecordPermission(actor: AuthActor) { return roleHasPermission(actor, 'recordPayments'); }

export class MediaService {
  constructor(private readonly storage: StorageDriver, private readonly logger: pino.Logger, private readonly receiptTtl = 300) {}

  async uploadImage(file: UploadFile, actor: AuthActor) {
    requireImageAccess(actor);
    if (file.size > IMAGE_MAX) throw new ValidationError('حجم الصورة لازم يكون 5 ميجابايت أو أقل.', [{ field: 'file', code: 'too_big' }]);
    const detected = await fromBuffer(file.buffer);
    const mime = detected?.mime;
    if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new ValidationError('نوع الصورة ده مش مدعوم. ارفع صورة بصيغة JPEG أو PNG أو WebP.', [{ field: 'file', code: 'unsupported_type' }]);
    let metadata: sharp.Metadata;
    try { metadata = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata(); }
    catch { throw new ValidationError('ملف الصورة غير صالح أو أبعاده أكبر من الحد المسموح.', [{ field: 'file', code: 'invalid_image' }]); }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) throw new ValidationError('أبعاد الصورة أكبر من الحد المسموح.', [{ field: 'file', code: 'pixel_limit' }]);
    const id = randomUUID().replaceAll('-', '');
    const keyPrefix = `media/${monthPath()}/${id}`;
    const variants: Array<{ name: string; width: number; height: number; key: string; body: Buffer }> = [];
    const widths = [{ name: 'thumb', width: 400 }, { name: 'medium', width: 800 }, { name: 'large', width: 1600 }, { name: 'original', width: metadata.width }];
    for (const variant of widths) {
      let output: Awaited<ReturnType<ReturnType<typeof sharp>['toBuffer']>>;
      try { output = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate().resize({ width: variant.width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true }); }
      catch { throw new ValidationError('ملف الصورة غير صالح أو أبعاده أكبر من الحد المسموح.', [{ field: 'file', code: 'invalid_image' }]); }
      variants.push({ name: variant.name, width: output.info.width, height: output.info.height, key: `${keyPrefix}-${variant.name}.webp`, body: output.data });
    }
    try {
      for (const variant of variants) await this.storage.put({ bucket: 'public', key: variant.key, body: variant.body, contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
      const original = variants.find((variant) => variant.name === 'original')!;
      const record = await Media.create({ key: original.key, bucket: 'public', mime: 'image/webp', size: original.body.length, width: original.width, height: original.height, displayName: uploadName(file.originalname), variants: variants.map(({ name, width, height, key }) => ({ key, width, height, mime: 'image/webp', name })), uploadedBy: objectId(actor.id) });
      await writeAudit({ actorId: actor.id, action: 'media_uploaded', entityType: 'media', entityId: String(record._id) }, this.logger);
      return this.project(record);
    } catch (error) {
      await Promise.allSettled(variants.map((variant) => this.storage.delete('public', variant.key)));
      this.logger.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Image upload failed');
      throw error;
    }
  }

  async uploadReceipt(file: UploadFile, actor: AuthActor) {
    if (!hasRecordPermission(actor)) throw new ForbiddenError('الصلاحية دي مش متاحة لحسابك.');
    if (file.size > RECEIPT_MAX) throw new ValidationError('حجم الإيصال لازم يكون 8 ميجابايت أو أقل.', [{ field: 'file', code: 'too_big' }]);
    const detected = await fromBuffer(file.buffer);
    if (!detected || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(detected.mime)) throw new ValidationError('نوع الإيصال ده مش مدعوم.', [{ field: 'file', code: 'unsupported_type' }]);
    let stored: Buffer = file.buffer;
    let storedMime = detected.mime;
    let width: number | undefined;
    let height: number | undefined;
    if (detected.mime !== 'application/pdf') {
      let metadata: sharp.Metadata;
      try { metadata = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata(); }
      catch { throw new ValidationError('ملف الإيصال غير صالح أو أبعاده أكبر من الحد المسموح.', [{ field: 'file', code: 'invalid_image' }]); }
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) throw new ValidationError('أبعاد الصورة أكبر من الحد المسموح.', [{ field: 'file', code: 'pixel_limit' }]);
      let output: { data: Buffer; info: { width: number; height: number } };
      try { output = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate().webp({ quality: 82 }).toBuffer({ resolveWithObject: true }); }
      catch { throw new ValidationError('ملف الإيصال غير صالح أو أبعاده أكبر من الحد المسموح.', [{ field: 'file', code: 'invalid_image' }]); }
      stored = output.data; storedMime = 'image/webp'; width = output.info.width; height = output.info.height;
    }
    const extension = storedMime === 'application/pdf' ? 'pdf' : 'webp';
    const key = `receipts/${monthPath()}/${randomBytes(20).toString('hex')}.${extension}`;
    try {
      await this.storage.put({ bucket: 'private', key, body: stored, contentType: storedMime });
      const record = await Media.create({ key, bucket: 'private', mime: storedMime, size: stored.length, ...(width ? { width, height } : {}), displayName: uploadName(file.originalname), uploadedBy: objectId(actor.id) });
      await writeAudit({ actorId: actor.id, action: 'media_uploaded', entityType: 'media', entityId: String(record._id) }, this.logger);
      return { id: String(record._id), key: record.key };
    } catch (error) {
      await Promise.allSettled([this.storage.delete('private', key)]);
      this.logger.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Receipt upload failed');
      throw error;
    }
  }

  async list(query: MediaListQuery, actor: AuthActor) {
    requireImageAccess(actor);
    const filter: Record<string, unknown> = { bucket: 'public' };
    if (query.search) filter.displayName = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (query.usage === 'used') filter['usages.0'] = { $exists: true };
    if (query.usage === 'unused') filter.usages = { $size: 0 };
    const [rows, total] = await Promise.all([Media.find(filter).sort({ createdAt: query.sort === 'oldest' ? 1 : -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).populate('uploadedBy', 'name').lean(), Media.countDocuments(filter)]);
    return { items: rows.map((row) => { const uploader = row.uploadedBy as unknown as { _id: unknown; name: string }; return { ...this.project(row), displayName: row.displayName ?? '', uploader: { id: String(uploader._id), name: uploader.name }, usageCount: row.usages.length, usages: row.usages.map((usage) => ({ entityType: usage.entityType, entityId: String(usage.entityId), field: usage.field })) }; }), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string, actor: AuthActor) {
    requireImageAccess(actor);
    const media = await Media.findOne({ _id: objectId(id), bucket: 'public' }).lean();
    if (!media) throw new NotFoundError('الملف ده مش موجود.');
    return { ...this.project(media), usages: media.usages.map((usage) => ({ entityType: usage.entityType, entityId: String(usage.entityId), field: usage.field })) };
  }

  async remove(id: string, actor: AuthActor) {
    if (actor.role !== 'admin') throw new NotFoundError('الملف ده مش موجود.');
    const media = await Media.findById(objectId(id));
    if (!media) throw new NotFoundError('الملف ده مش موجود.');
    if (media.usages.length) throw new AppError('MEDIA_IN_USE', 'ما ينفعش حذف الملف لأنه مستخدم.', 409, media.usages.map((usage) => ({ entityType: usage.entityType, entityId: String(usage.entityId), field: usage.field })));
    const bucket = media.bucket as 'public' | 'private';
    await Promise.all((media.variants.length ? media.variants.map((variant) => variant.key) : [media.key]).map((key) => this.storage.delete(bucket, key)));
    await media.deleteOne();
    await writeAudit({ actorId: actor.id, action: 'media_deleted', entityType: 'media', entityId: String(media._id) }, this.logger);
    return { deleted: true, id: String(media._id) };
  }

  async receiptUrl(id: string, actor: AuthActor) {
    if (!hasPaymentPermission(actor)) throw new NotFoundError('الإيصال ده مش موجود.');
    const receipt = await Media.findOne({ _id: objectId(id), bucket: 'private' }).lean();
    if (!receipt) throw new NotFoundError('الإيصال ده مش موجود.');
    const url = await this.storage.signedGetUrl('private', receipt.key, this.receiptTtl);
    await AuditLog.create({ actorId: objectId(actor.id), action: 'receipt_viewed', entityType: 'media', entityId: receipt._id, occurredAt: new Date() });
    return { url, expiresIn: this.receiptTtl };
  }

  async attachReceipt(key: string, paymentId: mongoose.Types.ObjectId, actor: AuthActor, session: ClientSession) {
    if (!hasRecordPermission(actor) || !/^receipts\/\d{4}\/(?:0[1-9]|1[0-2])\/[a-f\d]{40}\.(?:webp|pdf)$/i.test(key)) throw new ValidationError('الإيصال المحدد مش صالح.', [{ field: 'receiptMediaKey' }]);
    const media = await Media.findOne({ key, bucket: 'private' }).session(session);
    if (!media || (actor.role !== 'admin' && String(media.uploadedBy) !== actor.id) || media.usages.some((usage) => usage.entityType === 'payment')) throw new ValidationError('الإيصال مش موجود أو مرتبط بعملية تانية.', [{ field: 'receiptMediaKey' }]);
    media.usages.push({ entityType: 'payment', entityId: paymentId, field: 'receiptMediaKey' });
    await media.save({ session });
    return media;
  }

  project(record: MediaRecordProjection) {
    return { id: String(record._id), key: record.key, variants: Object.fromEntries((record.variants ?? []).map((variant: { name?: string; key: string }) => [variant.name ?? variant.key.split('-').at(-1)?.split('.')[0], variant.key])), width: record.width, height: record.height, mime: record.mime, size: record.size, createdAt: record.createdAt };
  }

  async addUsage(mediaId: string, usage: { entityType: 'course' | 'settings' | 'payment'; entityId: string; field: string }, session?: ClientSession) {
    const media = await Media.findOne({ _id: objectId(mediaId), bucket: 'public' }).session(session ?? null);
    if (!media) throw new NotFoundError('الملف ده مش موجود.');
    if (!media.usages.some((item) => item.entityType === usage.entityType && String(item.entityId) === usage.entityId && item.field === usage.field)) media.usages.push({ entityType: usage.entityType, entityId: objectId(usage.entityId), field: usage.field });
    await media.save(session ? { session } : undefined);
  }
  async removeUsage(mediaId: string, usage: { entityType: 'course' | 'settings' | 'payment'; entityId: string; field: string }, session?: ClientSession) {
    await Media.updateOne({ _id: objectId(mediaId), bucket: 'public' }, { $pull: { usages: { entityType: usage.entityType, entityId: objectId(usage.entityId), field: usage.field } } }, session ? { session } : undefined);
  }
  async recomputeUsage(mediaId: string, references: Array<{ entityType: 'course' | 'settings' | 'payment'; entityId: string; field: string }>) {
    await Media.updateOne({ _id: objectId(mediaId), bucket: 'public' }, { $set: { usages: references.map((item) => ({ ...item, entityId: objectId(item.entityId) })) } });
  }
  async purgeUnattachedReceipts(olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
    const old = await Media.find({ bucket: 'private', usages: { $size: 0 }, createdAt: { $lt: olderThan } });
    for (const receipt of old) { await this.storage.delete('private', receipt.key); await receipt.deleteOne(); }
    return old.length;
  }
}
