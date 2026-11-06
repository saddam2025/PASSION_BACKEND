import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import type pino from 'pino';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { cairoDayRange } from '../lib/time';
import { withTransaction } from '../lib/withTransaction';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Notification } from '../models/Notification';
import { Payment } from '../models/Payment';
import { Media } from '../models/Media';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import type { AuthActor } from '../types/express';
import type { paymentListQuerySchema, recordPaymentBodySchema } from '../shared/schemas/staffRecords';
import type { z } from 'zod';
import { confirmedNet, derivePaymentStatus, outstandingAmount, type PaymentStatusRecord } from './paymentStatus';
import { writeAudit } from './audit';
import type { MediaService } from './mediaService';
import { hasPermission as roleHasPermission } from '../shared/schemas/permissions';

type RecordPaymentInput = z.infer<typeof recordPaymentBodySchema>;
type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
type SummaryEnrollment = { enrollmentStatus: 'pending' | 'confirmed' | 'cancelled'; priceSnapshot: { amount: number | null; currency: string } };
type PaymentSummaryWithOutstanding = ReturnType<typeof summaryFor> & { outstandingMinor: number | null };
type PaymentRow = PaymentStatusRecord & { _id: mongoose.Types.ObjectId; enrollmentId: mongoose.Types.ObjectId; receivedAt: Date; status: 'confirmed' | 'voided'; currency: string; method: string; reference?: string; note?: string; receiptMediaKey?: string; receiptId?: string | null; recordedBy: mongoose.Types.ObjectId; confirmedBy: mongoose.Types.ObjectId; voidedAt?: Date; voidedBy?: mongoose.Types.ObjectId; voidReason?: string; createdAt?: Date };

function objectId(value: string) {
  if (!mongoose.isValidObjectId(value)) throw new NotFoundError('السجل ده مش موجود.');
  return new mongoose.Types.ObjectId(value);
}
function hasPermission(actor: AuthActor, permission: 'viewPayments' | 'recordPayments' | 'exportCsv'): boolean {
  return roleHasPermission(actor, permission);
}
function requirePermission(actor: AuthActor, permission: 'viewPayments' | 'recordPayments' | 'exportCsv'): void {
  if (!hasPermission(actor, permission)) throw new ForbiddenError('الصلاحية دي مش متاحة لحسابك.');
}
function requireAdmin(actor: AuthActor): void {
  if (actor.role !== 'admin') throw new ForbiddenError('العملية دي متاحة للمسؤول بس.');
}
async function withReceiptIds(records: readonly PaymentRow[]): Promise<PaymentRow[]> {
  const attached = records.filter((record) => record.receiptMediaKey);
  if (!attached.length) return records.map((record) => ({ ...record, receiptId: null }));
  const paymentIds = attached.map((record) => record._id);
  const keys = [...new Set(attached.map((record) => record.receiptMediaKey!))];
  const media = await Media.find({
    bucket: 'private', key: { $in: keys },
    usages: { $elemMatch: { entityType: 'payment', entityId: { $in: paymentIds }, field: 'receiptMediaKey' } },
  }).select('_id usages').lean();
  const byPaymentId = new Map<string, string>();
  for (const receipt of media) {
    for (const usage of receipt.usages ?? []) {
      if (usage.entityType === 'payment' && usage.field === 'receiptMediaKey' && paymentIds.some((id) => String(id) === String(usage.entityId))) {
        byPaymentId.set(String(usage.entityId), String(receipt._id));
      }
    }
  }
  return records.map((record) => ({ ...record, receiptId: byPaymentId.get(String(record._id)) ?? null }));
}

function paymentProjection(record: PaymentRow, includeReceiptId = false) {
  return {
    id: String(record._id), enrollmentId: String(record.enrollmentId), kind: record.kind, amount: record.amount, currency: record.currency,
    method: record.method, ...(record.reference ? { reference: record.reference } : {}), ...(record.note ? { note: record.note } : {}),
    ...(record.receiptMediaKey ? { receiptMediaKey: record.receiptMediaKey } : {}),
    ...(includeReceiptId ? { receiptId: record.receiptId ?? null } : {}), receivedAt: record.receivedAt, status: record.status,
    ...(record.voidedAt ? { voidedAt: record.voidedAt } : {}), ...(record.voidedBy ? { voidedBy: String(record.voidedBy) } : {}),
    ...(record.voidReason ? { voidReason: record.voidReason } : {}), recordedBy: String(record.recordedBy), confirmedBy: String(record.confirmedBy), createdAt: record.createdAt,
  };
}
function payloadHash(enrollmentId: string, input: RecordPaymentInput): string {
  const normalized = { enrollmentId, ...input, currency: input.currency.toUpperCase(), receivedAt: new Date(input.receivedAt).toISOString(), reference: input.reference ?? '', note: input.note ?? '', receiptMediaKey: input.receiptMediaKey ?? '' };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function asStatusRecords(records: readonly PaymentRow[]): PaymentStatusRecord[] {
  return records.map(({ kind, amount, status }) => ({ kind, amount, status }));
}
function summaryFor(enrollment: SummaryEnrollment, records: readonly PaymentRow[]) {
  const active = records.filter((record) => record.status === 'confirmed');
  const lastPaymentAt = active.reduce<Date | null>((latest, item) => !latest || item.receivedAt > latest ? item.receivedAt : latest, null);
  return { netMinor: Math.max(confirmedNet(asStatusRecords(records)), 0), currency: enrollment.priceSnapshot.currency, status: derivePaymentStatus(enrollment, asStatusRecords(records)), lastPaymentAt };
}
export async function recomputePaymentSummary(enrollmentId: mongoose.Types.ObjectId | string, session?: ClientSession) {
  let enrollmentQuery = Enrollment.findById(enrollmentId);
  let recordQuery = Payment.find({ enrollmentId });
  if (session) { enrollmentQuery = enrollmentQuery.session(session); recordQuery = recordQuery.session(session); }
  const [enrollment, records] = await Promise.all([enrollmentQuery.lean(), recordQuery.lean()]);
  if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
  return summaryFor(enrollment as SummaryEnrollment, records as unknown as PaymentRow[]);
}
async function updateSummary(enrollmentId: mongoose.Types.ObjectId, session: ClientSession) {
  const enrollment = await Enrollment.findById(enrollmentId).session(session).lean();
  if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
  const records = await Payment.find({ enrollmentId }).session(session).lean();
  const summary = summaryFor(enrollment as SummaryEnrollment, records as unknown as PaymentRow[]);
  await Enrollment.updateOne({ _id: enrollmentId }, { $set: { paymentSummary: summary } }, { session, runValidators: true });
  return summary;
}
export async function refreshEnrollmentPaymentSummary(enrollmentId: mongoose.Types.ObjectId | string) {
  return withTransaction(async (session) => updateSummary(new mongoose.Types.ObjectId(enrollmentId), session));
}
async function statusSummary(enrollment: SummaryEnrollment, records: PaymentRow[]) {
  const summary = summaryFor(enrollment, records);
  return { ...summary, outstandingMinor: outstandingAmount(enrollment, asStatusRecords(records)) };
}
function mapRecordWithStaff(record: PaymentRow, staff: Map<string, string>) {
  return { ...paymentProjection(record, true), recordedBy: { id: String(record.recordedBy), name: { ar: staff.get(String(record.recordedBy)) ?? '' } }, confirmedBy: { id: String(record.confirmedBy), name: { ar: staff.get(String(record.confirmedBy)) ?? '' } }, ...(record.voidedBy ? { voidedBy: { id: String(record.voidedBy), name: { ar: staff.get(String(record.voidedBy)) ?? '' } } } : {}) };
}

async function projectOnePayment(record: PaymentRow, includeReceiptId: boolean) {
  const [withId] = await withReceiptIds([record]);
  return paymentProjection(withId!, includeReceiptId);
}

export const paymentsService = {
  async record(enrollmentIdValue: string, input: RecordPaymentInput, actor: AuthActor, logger: pino.Logger, mediaService?: MediaService) {
    if (input.kind === 'payment') requirePermission(actor, 'recordPayments'); else requireAdmin(actor);
    const enrollmentId = objectId(enrollmentIdValue);
    const requestHash = payloadHash(String(enrollmentId), input);
    const replay = await Payment.findOne({ idempotencyKey: input.idempotencyKey }).select('+payloadHash').lean();
    if (replay) {
      if (replay.payloadHash !== requestHash) throw new ConflictError('مفتاح الطلب مستخدم ببيانات مختلفة.');
      const enrollment = await Enrollment.findById(replay.enrollmentId).lean();
      if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
      const records = await Payment.find({ enrollmentId: replay.enrollmentId }).lean() as unknown as PaymentRow[];
      return { payment: await projectOnePayment(replay as unknown as PaymentRow, hasPermission(actor, 'viewPayments')), paymentSummary: await statusSummary(enrollment as SummaryEnrollment, records), replayed: true };
    }

    const normalizedInput = { ...input, currency: input.currency.toUpperCase(), reference: input.reference?.trim() || undefined, note: input.note?.trim() || undefined };
    let createdId: mongoose.Types.ObjectId | undefined;
    let summary: PaymentSummaryWithOutstanding | undefined;
    let replayed = false;
    try {
      await withTransaction(async (session) => {
        const enrollment = await Enrollment.findById(enrollmentId).session(session).lean();
        if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
        if (enrollment.enrollmentStatus === 'cancelled' && normalizedInput.kind === 'payment') throw new ConflictError('ما ينفعش تسجيل دفعة جديدة لتسجيل ملغي.');
        const setting = await Settings.findOne({ key: 'academy' }).session(session).lean();
        const currencies = setting?.enabledCurrencies?.length ? setting.enabledCurrencies : ['EGP'];
        const price = enrollment.priceSnapshot;
        if (!price) throw new ValidationError('بيانات سعر التسجيل غير مكتملة.');
        if (price.amount !== null && normalizedInput.currency !== price.currency) throw new ValidationError('عملة السجل لازم تطابق عملة التسجيل.', [{ field: 'currency' }]);
        if (price.amount === null && !currencies.includes(normalizedInput.currency)) throw new ValidationError('العملة دي مش مفعلة في إعدادات الأكاديمية.', [{ field: 'currency' }]);

        const prior = await Payment.findOne({ idempotencyKey: input.idempotencyKey }).select('+payloadHash').session(session).lean();
        if (prior) {
          if (prior.payloadHash !== requestHash) throw new ConflictError('مفتاح الطلب مستخدم ببيانات مختلفة.');
          createdId = prior._id;
          replayed = true;
          summary = await statusSummary(enrollment as SummaryEnrollment, await Payment.find({ enrollmentId }).session(session).lean() as unknown as PaymentRow[]);
          return;
        }

        const records = await Payment.find({ enrollmentId }).session(session).lean() as unknown as PaymentRow[];
        if (normalizedInput.kind === 'refund') {
          const net = confirmedNet(asStatusRecords(records));
          if (net <= 0) throw new ConflictError('مافيش مبلغ متاح للاسترداد.');
          if (normalizedInput.amount > net) throw new ConflictError('قيمة الاسترداد أكبر من صافي المبلغ المؤكد.');
        }
        const created = await Payment.create([{
          enrollmentId, ...normalizedInput, receivedAt: new Date(normalizedInput.receivedAt), status: 'confirmed',
          recordedBy: new mongoose.Types.ObjectId(actor.id), confirmedBy: new mongoose.Types.ObjectId(actor.id), idempotencyKey: input.idempotencyKey, payloadHash: requestHash,
        }], { session });
        createdId = created[0]!._id;
        if (normalizedInput.receiptMediaKey) {
          if (!mediaService) throw new ValidationError('تعذر التحقق من الإيصال.', [{ field: 'receiptMediaKey' }]);
          await mediaService.attachReceipt(normalizedInput.receiptMediaKey, createdId, actor, session);
        }
        const persistedSummary = await updateSummary(enrollmentId, session);
        summary = { ...persistedSummary, outstandingMinor: outstandingAmount(enrollment as SummaryEnrollment, asStatusRecords([...records, created[0]!.toObject() as unknown as PaymentRow])) };
      });
    } catch (error) {
      const duplicate = await Payment.findOne({ idempotencyKey: input.idempotencyKey }).select('+payloadHash').lean();
      if (duplicate?.payloadHash === requestHash) {
        const enrollment = await Enrollment.findById(duplicate.enrollmentId).lean();
        if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
        const all = await Payment.find({ enrollmentId: duplicate.enrollmentId }).lean() as unknown as PaymentRow[];
        return { payment: await projectOnePayment(duplicate as unknown as PaymentRow, hasPermission(actor, 'viewPayments')), paymentSummary: await statusSummary(enrollment as SummaryEnrollment, all), replayed: true };
      }
      if (duplicate) throw new ConflictError('مفتاح الطلب مستخدم ببيانات مختلفة.');
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      throw error;
    }
    if (!createdId || !summary) throw new AppError('PAYMENT_FAILED', 'تعذر تسجيل العملية. حاول تاني.', 500);
    const record = await Payment.findById(createdId).lean();
    if (!record) throw new AppError('PAYMENT_FAILED', 'تعذر تحميل سجل العملية.', 500);
    if (replayed) return { payment: await projectOnePayment(record as unknown as PaymentRow, hasPermission(actor, 'viewPayments')), paymentSummary: summary, replayed: true };
    const action = normalizedInput.kind === 'refund' ? 'refund_recorded' : 'payment_recorded';
    await writeAudit({ actorId: actor.id, action, entityType: 'payment', entityId: String(createdId), afterStatus: 'confirmed', note: `${normalizedInput.kind}:${normalizedInput.currency}:${normalizedInput.amount}` }, logger);
    if (normalizedInput.kind === 'payment') await notifyPayment(record.enrollmentId, record._id, record.amount, logger);
    return { payment: await projectOnePayment(record as unknown as PaymentRow, hasPermission(actor, 'viewPayments')), paymentSummary: summary, replayed: false };
  },

  async void(paymentIdValue: string, reason: string, actor: AuthActor, logger: pino.Logger) {
    if (actor.role !== 'admin') requirePermission(actor, 'recordPayments');
    const paymentId = objectId(paymentIdValue);
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3) throw new ValidationError('سبب الإلغاء مطلوب.', [{ field: 'reason' }]);
    let summary: PaymentSummaryWithOutstanding | undefined;
    let enrollmentId: mongoose.Types.ObjectId | undefined;
    let voidedPaymentId: mongoose.Types.ObjectId | undefined;
    await withTransaction(async (session) => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment || payment.status !== 'confirmed') throw new NotFoundError('سجل الدفع ده مش موجود.');
      if (actor.role !== 'admin' && (payment.kind !== 'payment' || String(payment.recordedBy) !== actor.id)) throw new ForbiddenError('تقدر تلغي دفعة سجلتها بنفسك بس.');
      enrollmentId = payment.enrollmentId;
      const enrollment = await Enrollment.findById(enrollmentId).session(session).lean();
      if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
      const records = await Payment.find({ enrollmentId }).session(session).lean() as unknown as PaymentRow[];
      const afterVoid = records.map((item) => String(item._id) === String(payment._id) ? { ...item, status: 'voided' as const } : item);
      if (confirmedNet(asStatusRecords(afterVoid)) < 0) throw new ConflictError('ما ينفعش إلغاء العملية لأنها هتخلي صافي المدفوعات بالسالب.');
      payment.status = 'voided'; payment.voidReason = normalizedReason; payment.voidedAt = new Date(); payment.voidedBy = new mongoose.Types.ObjectId(actor.id);
      await payment.save({ session });
      voidedPaymentId = payment._id;
      const persistedSummary = await updateSummary(enrollmentId!, session);
      summary = { ...persistedSummary, outstandingMinor: outstandingAmount(enrollment as SummaryEnrollment, asStatusRecords(afterVoid)) };
    });
    if (!enrollmentId || !voidedPaymentId || !summary) throw new AppError('PAYMENT_FAILED', 'تعذر إلغاء العملية.', 500);
    const payment = await Payment.findById(voidedPaymentId).lean();
    await writeAudit({ actorId: actor.id, action: 'payment_voided', entityType: 'payment', entityId: String(voidedPaymentId), beforeStatus: 'confirmed', afterStatus: 'voided', ...(payment ? { note: `${payment.kind}:${payment.currency}:${payment.amount}:${summary.netMinor}` } : {}) }, logger);
    return { payment: await projectOnePayment(payment as unknown as PaymentRow, hasPermission(actor, 'viewPayments')), paymentSummary: summary };
  },

  async listForEnrollment(enrollmentIdValue: string, actor: AuthActor) {
    requirePermission(actor, 'viewPayments');
    const enrollmentId = objectId(enrollmentIdValue);
    const enrollment = await Enrollment.findById(enrollmentId).lean();
    if (!enrollment) throw new NotFoundError('التسجيل ده مش موجود.');
    const records = await withReceiptIds(await Payment.find({ enrollmentId }).sort({ receivedAt: -1, _id: -1 }).lean() as unknown as PaymentRow[]);
    const staff = await User.find({ _id: { $in: records.flatMap((record) => [record.recordedBy, record.confirmedBy, record.voidedBy].filter(Boolean)) } }).select('_id name').lean();
    const staffNames = new Map(staff.map((user) => [String(user._id), user.name]));
    const paymentSummary = await statusSummary(enrollment as SummaryEnrollment, records);
    return { items: records.map((record) => mapRecordWithStaff(record, staffNames)), total: records.length, paymentSummary };
  },

  async list(query: PaymentListQuery, actor: AuthActor) {
    requirePermission(actor, 'viewPayments');
    const range = cairoDayRange(query.dateFrom, query.dateTo);
    const match: Record<string, unknown> = {};
    if (query.method) match.method = query.method;
    if (query.kind) match.kind = query.kind;
    if (query.status) match.status = query.status;
    if (range.from || range.to) match.receivedAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) };
    const pipeline: mongoose.PipelineStage[] = [
      { $match: match },
      { $lookup: { from: Enrollment.collection.name, localField: 'enrollmentId', foreignField: '_id', as: 'enrollment' } },
      { $unwind: '$enrollment' },
      ...(query.courseId ? [{ $match: { 'enrollment.courseId': new mongoose.Types.ObjectId(query.courseId) } } as mongoose.PipelineStage] : []),
      { $sort: { receivedAt: query.sort === 'oldest' ? 1 : -1, _id: query.sort === 'oldest' ? 1 : -1 } },
      { $facet: { items: [{ $skip: (query.page - 1) * query.pageSize }, { $limit: query.pageSize }, { $lookup: { from: Lead.collection.name, localField: 'enrollment.leadId', foreignField: '_id', as: 'lead' } }, { $unwind: '$lead' }], total: [{ $count: 'value' }] } },
    ];
    const [result] = await Payment.aggregate<{ items: Array<Record<string, unknown>>; total: Array<{ value: number }> }>(pipeline);
    const rows = (result?.items ?? []) as unknown as Array<PaymentRow & { enrollment: Record<string, unknown>; lead: Record<string, unknown> }>;
    const staffIds = rows.flatMap((record) => [record.recordedBy, record.confirmedBy, record.voidedBy].filter(Boolean));
    const staff = await User.find({ _id: { $in: staffIds } }).select('_id name').lean();
    const staffNames = new Map(staff.map((user) => [String(user._id), user.name]));
    return { items: rows.map((record) => ({ ...mapRecordWithStaff(record, staffNames), enrollment: { reference: record.enrollment.reference, courseTitle: record.enrollment.courseSnapshot && (record.enrollment.courseSnapshot as { title?: unknown }).title, enrollmentStatus: record.enrollment.enrollmentStatus }, lead: { fullName: record.lead.fullName, email: record.lead.email, phone: record.lead.phone } })), total: result?.total[0]?.value ?? 0, page: query.page, pageSize: query.pageSize };
  },
};

async function notifyPayment(enrollmentId: mongoose.Types.ObjectId, paymentId: mongoose.Types.ObjectId, amount: number, logger: pino.Logger) {
  try {
    const enrollment = await Enrollment.findById(enrollmentId).select('reference assignedTo').lean();
    if (!enrollment) return;
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
    const recipients = new Set(admins.map((user) => String(user._id)));
    if (enrollment.assignedTo) {
      const assistant = await User.findOne({ _id: enrollment.assignedTo, role: 'assistant', isActive: true }).select('_id').lean();
      if (assistant) recipients.add(String(assistant._id));
    }
    if (recipients.size) await Notification.create([...recipients].map((recipientId) => ({ recipientId, type: 'payment_recorded', params: { reference: enrollment.reference, amount }, entityType: 'payment', entityId: paymentId })));
  } catch (error) {
    logger.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Payment notification could not be delivered');
  }
}
