import 'dotenv/config';
import mongoose from 'mongoose';
import pino from 'pino';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnvironment } from '../config/env';
import { createApp } from '../app/createApp';
import { createLogger } from '../config/logger';
import { ValidationError } from '../lib/errors';
import { AuditLog } from '../models/AuditLog';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Media } from '../models/Media';
import { Notification } from '../models/Notification';
import { Payment } from '../models/Payment';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { MediaService } from '../services/mediaService';
import { createAccessToken } from '../services/authTokens';
import { paymentsService } from '../services/paymentsService';
import { MemoryStorageDriver } from '../services/storageDriver';
import { hashPassword } from '../services/passwords';
import type { AuthActor } from '../types/express';
import { clearNamedCollections, assertTestDatabaseName } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-6 media integration tests require MONGODB_URI_TEST; skipped tests are not accepted.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-6 media integration tests require NODE_ENV=test.');
const collections = [Media, AuditLog, User, Enrollment, Lead, Payment, Settings, Notification].map((model) => model.collection.name);
const storage = new MemoryStorageDriver();
const logger = pino({ level: 'silent' });
const service = new MediaService(storage, logger, 300);
const adminId = new mongoose.Types.ObjectId();
const assistantId = new mongoose.Types.ObjectId();
const admin: AuthActor = { id: String(adminId), name: { ar: 'مسؤول' }, email: 'media-admin@example.test', role: 'admin', permissions: [] };
const assistant: AuthActor = { id: String(assistantId), name: { ar: 'مساعد' }, email: 'media-assistant@example.test', role: 'assistant', permissions: ['recordPayments', 'viewPayments', 'viewLeads'] };
const httpEmail = 'media-http-admin@example.test';
const httpPassword = 'MediaHttpAdminPassphrase9!';
const httpEnvironment = parseEnvironment({ NODE_ENV: 'test', PORT: '4000', MONGODB_URI: 'mongodb://127.0.0.1:27017/passion_test?replicaSet=rs0', ACCESS_TOKEN_SECRET: 'media-test-access-secret-long-enough-0001', REFRESH_TOKEN_SECRET: 'media-test-refresh-secret-long-enough-0002', COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent' });
const httpApp = createApp(httpEnvironment, { logger: createLogger('silent') });

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, collections);
  await User.create([{ _id: adminId, email: admin.email, name: 'مسؤول', role: 'admin', passwordHash: 'test-password-hash-not-used-000001', isActive: true }, { _id: assistantId, email: assistant.email, name: 'مساعد', role: 'assistant', passwordHash: 'test-password-hash-not-used-000002', isActive: true }]);
  await User.create({ email: httpEmail, name: 'مسؤول الاختبار', role: 'admin', passwordHash: await hashPassword(httpPassword), isActive: true });
}, 60_000);
afterAll(async () => {
  if (mongoose.connection.readyState === 1) { await clearNamedCollections(mongoose.connection, collections); await mongoose.disconnect(); }
});

async function png(withMetadata = false) {
  const image = sharp({ create: { width: 64, height: 48, channels: 3, background: '#bada55' } });
  const encoded = image.png();
  return withMetadata ? encoded.withMetadata().toBuffer() : encoded.toBuffer();
}
function upload(buffer: Buffer, originalname = 'original-secret-name.png', size = buffer.length) { return { buffer, originalname, size }; }
function expectValidation(promise: Promise<unknown>) { return expect(promise).rejects.toBeInstanceOf(ValidationError); }

describe('BE-6 media upload, privacy and usage (Atlas + in-memory storage)', () => {
  it('returns 401 without auth, rejects multipart writes without CSRF, and accepts an authenticated multipart upload and list', async () => {
    await request(httpApp).get('/api/v1/media').expect(401);
    const client = request.agent(httpApp);
    const csrfResponse = await client.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = csrfResponse.body.csrfToken as string;
    await client.post('/api/v1/auth/login').set('Origin', httpEnvironment.CORS_ORIGINS[0]!).set('X-CSRF-Token', csrfToken).send({ email: httpEmail, password: httpPassword }).expect(200);
    await client.post('/api/v1/media').set('Origin', httpEnvironment.CORS_ORIGINS[0]!).attach('file', await png(), { filename: 'http-upload.png', contentType: 'image/png' }).expect(403);
    const uploaded = await client.post('/api/v1/media').set('Origin', httpEnvironment.CORS_ORIGINS[0]!).set('X-CSRF-Token', csrfToken).attach('file', await png(), { filename: 'http-upload.png', contentType: 'image/png' });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body).toMatchObject({ mime: 'image/webp', key: expect.stringMatching(/^media\//) });
    const listed = await client.get('/api/v1/media').expect(200);
    expect(listed.body.items.some((item: { id: string }) => item.id === uploaded.body.id)).toBe(true);
    await Media.updateOne({ _id: uploaded.body.id }, { $push: { usages: { entityType: 'course', entityId: adminId, field: 'hero.image' } } });
    const refused = await client.delete(`/api/v1/media/${uploaded.body.id}`).set('Origin', httpEnvironment.CORS_ORIGINS[0]!).set('X-CSRF-Token', csrfToken).expect(409);
    expect(refused.body.error.details).toMatchObject([{ entityType: 'course', field: 'hero.image' }]);
    const receipt = await client.post('/api/v1/media/receipts').set('Origin', httpEnvironment.CORS_ORIGINS[0]!).set('X-CSRF-Token', csrfToken).attach('file', Buffer.from('%PDF-1.7\n%%EOF'), { filename: 'private.pdf', contentType: 'application/pdf' }).expect(201);
    expect(receipt.body.key).toMatch(/^receipts\//);
    const signed = await client.get(`/api/v1/media/receipts/${receipt.body.id}/url`).expect(200);
    expect(signed.body).toMatchObject({ expiresIn: 300, url: expect.stringMatching(/^memory:\/\/private\//) });
  });

  it('valid png upload creates four re-encoded variants, strips metadata, stores random relative keys and never uses the filename', async () => {
    const source = await png(true);
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const created = await service.uploadImage(upload(source), admin);
    expect(Object.keys(created.variants)).toEqual(['thumb', 'medium', 'large', 'original']);
    expect(created.key).toMatch(/^media\/\d{4}\/\d{2}\/[a-f0-9]{32}-original\.webp$/);
    expect(created.key).not.toContain('original-secret-name');
    expect(created.mime).toBe('image/webp');
    for (const key of Object.values(created.variants) as string[]) {
      expect(key).toMatch(/^media\/\d{4}\/\d{2}\/[a-f0-9-]+-(?:thumb|medium|large|original)\.webp$/);
      const object = await storage.get('public', key);
      expect(object?.contentType).toBe('image/webp');
      expect((await sharp(object!.body).metadata()).exif).toBeUndefined();
    }
  });

  it('rejects bytes renamed as jpg, SVG, polyglot/invalid bytes, files above 5 MB and excessive pixel dimensions', async () => {
    await expectValidation(service.uploadImage(upload(Buffer.from('not an image'), 'renamed.jpg'), admin));
    await expectValidation(service.uploadImage(upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image.svg'), admin));
    const fakePolyglot = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<html><script>')]);
    await expectValidation(service.uploadImage(upload(fakePolyglot, 'image.png'), admin));
    const small = await png();
    await expect(service.uploadImage(upload(small, 'oversized.png', 5 * 1024 * 1024 + 1), admin)).rejects.toMatchObject({ details: [{ code: 'too_big' }] });
    const bomb = Buffer.from(small);
    bomb.writeUInt32BE(100_000, 16); bomb.writeUInt32BE(100_000, 20);
    await expectValidation(service.uploadImage(upload(bomb, 'dimensions.png'), admin));
  });

  it('accepts PDF only through private receipt upload and returns relative receipt keys', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    await expectValidation(service.uploadImage(upload(pdf, 'receipt.pdf'), admin));
    const receipt = await service.uploadReceipt(upload(pdf, 'receipt.pdf'), admin);
    expect(receipt.key).toMatch(/^receipts\/\d{4}\/\d{2}\/[a-f0-9]{40}\.pdf$/);
    expect(await storage.exists('private', receipt.key)).toBe(true);
    expect(receipt.key).not.toContain('receipt.pdf');
    expect(await storage.get('public', receipt.key)).toBeNull();
  });

  it('searches, paginates and filters the media library by usage', async () => {
    const created = await service.uploadImage(upload(await png(), 'بحث عربي.png'), admin);
    await service.uploadImage(upload(await png(), 'صورة تانية.png'), admin);
    await service.addUsage(created.id, { entityType: 'course', entityId: String(adminId), field: 'hero.image' });
    const used = await service.list({ page: 1, pageSize: 1, search: 'بحث', usage: 'used', sort: 'newest' }, admin);
    expect(used.total).toBe(1);
    expect(used.items[0]).toMatchObject({ id: created.id, usageCount: 1, uploader: { id: String(adminId), name: 'مسؤول' } });
    const unused = await service.list({ page: 1, pageSize: 100, usage: 'unused', sort: 'newest' }, admin);
    expect(unused.items.some((item) => item.id === created.id)).toBe(false);
  });

  it('refuses used deletion with references, removes every variant for unused assets, and hides forbidden Assistant deletion', async () => {
    const used = await service.uploadImage(upload(await png()), admin);
    await service.addUsage(used.id, { entityType: 'course', entityId: String(adminId), field: 'hero.image' });
    await expect(service.remove(used.id, admin)).rejects.toMatchObject({ code: 'MEDIA_IN_USE', statusCode: 409, details: [{ entityType: 'course', field: 'hero.image' }] });
    await expect(service.remove(used.id, assistant)).rejects.toMatchObject({ statusCode: 404 });
    await service.removeUsage(used.id, { entityType: 'course', entityId: String(adminId), field: 'hero.image' });
    const unused = await service.uploadImage(upload(await png()), admin);
    const keys = Object.values(unused.variants) as string[];
    await service.remove(unused.id, admin);
    expect(await Media.findById(unused.id)).toBeNull();
    expect(await Promise.all(keys.map((key) => storage.exists('public', key)))).toEqual([false, false, false, false]);
  });

  it('uses fixed Assistant payment rights for private receipts and audits receipt access by ids', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%%EOF');
    const receipt = await service.uploadReceipt(upload(pdf), assistant);
    const signed = await service.receiptUrl(receipt.id, assistant);
    expect(signed.url).toMatch(/^memory:\/\/private\//);
    expect(signed.expiresIn).toBe(300);
    const legacyRestricted = await service.uploadReceipt(upload(pdf), { ...assistant, permissions: ['viewPayments'] });
    expect(legacyRestricted.key).toMatch(/^receipts\//);
    expect((await service.receiptUrl(receipt.id, { ...assistant, permissions: ['viewLeads'] })).url).toMatch(/^memory:\/\/private\//);
    const audit = await AuditLog.findOne({ action: 'receipt_viewed', entityId: receipt.id }).lean();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(signed.url);
  });

  it('restricts public media upload, list and get to Admin while preserving Assistant receipt access', async () => {
    const image = await service.uploadImage(upload(await png()), admin);
    await expect(service.uploadImage(upload(await png()), assistant)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list({ page: 1, pageSize: 10, sort: 'newest', usage: 'all' }, assistant)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.get(image.id, assistant)).rejects.toMatchObject({ statusCode: 403 });
    const assistantUser = await User.create({ email: 'media-route-assistant@example.test', name: 'مساعد الوسائط', role: 'assistant', passwordHash: 'media-assistant-test-password-hash-0001', isActive: true });
    const cookie = `passion_access=${createAccessToken(assistantUser, httpEnvironment)}`;
    await request(httpApp).get('/api/v1/media').set('Cookie', cookie).expect(403);
    await request(httpApp).get(`/api/v1/media/${image.id}`).set('Cookie', cookie).expect(403);
    await request(httpApp).delete(`/api/v1/media/${image.id}`).set('Cookie', cookie).expect(403);
    await request(httpApp).post('/api/v1/media').set('Cookie', cookie).expect(403);
  });

  it('attaches a private receipt once, rejects duplicate attachment and rejects a different Assistant', async () => {
    const receipt = await service.uploadReceipt(upload(Buffer.from('%PDF-1.7\n%%EOF')), assistant);
    const session = await mongoose.startSession();
    const firstPayment = new mongoose.Types.ObjectId();
    try { await session.withTransaction(async () => { await service.attachReceipt(receipt.key, firstPayment, assistant, session); }); }
    finally { await session.endSession(); }
    const nextSession = await mongoose.startSession();
    try { await expect(nextSession.withTransaction(async () => { await service.attachReceipt(receipt.key, new mongoose.Types.ObjectId(), assistant, nextSession); })).rejects.toBeInstanceOf(ValidationError); }
    finally { await nextSession.endSession(); }
    const strangerSession = await mongoose.startSession();
    try { await expect(strangerSession.withTransaction(async () => { await service.attachReceipt(receipt.key, new mongoose.Types.ObjectId(), { ...assistant, id: String(adminId) }, strangerSession); })).rejects.toBeInstanceOf(ValidationError); }
    finally { await strangerSession.endSession(); }
    expect((await Media.findById(receipt.id).lean())?.usages).toHaveLength(1);
  });

  it('payment creation verifies and attaches an existing private receipt in the payment transaction', async () => {
    const lead = await Lead.create({ fullName: 'عميل اختبار الإيصال', email: 'media-payment@example.test', phone: '01012345678', phoneNormalized: '201012345678', consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {} });
    const enrollment = await Enrollment.create({ reference: 'PAS-AB2345', leadId: lead._id, courseId: new mongoose.Types.ObjectId(), courseSnapshot: { title: { ar: 'كورس تجريبي' }, slug: 'receipt-course' }, priceSnapshot: { amount: 10_000, currency: 'EGP' }, consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: {}, enrollmentStatus: 'pending', followUpStatus: 'new', isActive: true, registeredAt: new Date(), idempotencyKey: 'media-enroll-receipt-test-001' });
    const receipt = await service.uploadReceipt(upload(Buffer.from('%PDF-1.7\n%%EOF')), admin);
    await paymentsService.record(String(enrollment._id), { kind: 'payment', amount: 1_000, currency: 'EGP', method: 'cash', receivedAt: new Date().toISOString(), receiptMediaKey: receipt.key, idempotencyKey: 'media-payment-receipt-test-001' }, admin, logger, service);
    const media = await Media.findById(receipt.id).lean();
    expect(media?.usages.map((usage) => ({ entityType: usage.entityType, entityId: String(usage.entityId), field: usage.field }))).toEqual([{ entityType: 'payment', entityId: expect.any(String), field: 'receiptMediaKey' }]);
    await expect(service.remove(receipt.id, admin)).rejects.toMatchObject({ code: 'MEDIA_IN_USE', statusCode: 409, details: [{ entityType: 'payment', field: 'receiptMediaKey' }] });
    await Media.collection.updateOne({ _id: new mongoose.Types.ObjectId(receipt.id) }, { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect(await service.purgeUnattachedReceipts()).toBe(0);
    expect(await storage.exists('private', receipt.key)).toBe(true);
  });

  it('purges only unattached private receipts older than 24 hours', async () => {
    const receipt = await service.uploadReceipt(upload(Buffer.from('%PDF-1.7\n%%EOF')), admin);
    await Media.collection.updateOne({ _id: new mongoose.Types.ObjectId(receipt.id) }, { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect(await service.purgeUnattachedReceipts()).toBe(1);
    expect(await storage.exists('private', receipt.key)).toBe(false);
  });
});

describe('BE-6 R2 configuration safety', () => {
  it('rejects partial R2 config and refuses production without the complete R2 set', () => {
    const base = { NODE_ENV: 'development', PORT: '4000', MONGODB_URI: 'mongodb://localhost:27017/passion', ACCESS_TOKEN_SECRET: 'media-test-access-secret-long-enough-0001', REFRESH_TOKEN_SECRET: 'media-test-refresh-secret-long-enough-0002', COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent' };
    expect(() => parseEnvironment({ ...base, R2_ACCOUNT_ID: 'configured' })).toThrow(/R2_ACCESS_KEY_ID/);
    expect(() => parseEnvironment({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' })).toThrow(/R2_ACCOUNT_ID/);
  });
});
