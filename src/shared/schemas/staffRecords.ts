import { z } from 'zod';
import { PaymentStatusSchema } from './payment';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const objectIdParam = z.string().transform((value) => /^[a-f\d]{24}$/i.test(value) ? value : 'invalid-object-id');
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'اكتب تاريخ صحيح.');

const enrollmentListQueryObjectSchema = z.object({
  search: z.string().trim().max(120).optional(),
  courseId: objectId.optional(),
  audience: z.enum(['egyptian', 'foreign']).optional(),
  enrollmentStatus: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
  followUpStatus: z.enum(['new', 'contacted', 'interested', 'awaiting_payment', 'no_answer', 'not_interested', 'closed']).optional(),
  paymentStatus: PaymentStatusSchema.exclude(['failed']).optional(),
  assignedTo: z.union([z.literal('me'), z.literal('unassigned'), objectId]).optional(),
  dateFrom: isoDay.optional(),
  dateTo: isoDay.optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'course', 'paymentStatus']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
}).strip();
function validateEnrollmentDateRange(value: { dateFrom?: string | undefined; dateTo?: string | undefined }, context: z.RefinementCtx) {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'تاريخ النهاية لازم يكون بعد تاريخ البداية.' });
  }
}
export const enrollmentListQuerySchema = enrollmentListQueryObjectSchema.superRefine(validateEnrollmentDateRange);
export const enrollmentExportGetQuerySchema = enrollmentListQueryObjectSchema.extend({ search: z.never().optional() }).superRefine(validateEnrollmentDateRange);

export const enrollmentIdParamsSchema = z.object({ id: objectIdParam }).strip();
export const leadIdParamsSchema = z.object({ id: objectIdParam }).strip();
export const notificationIdParamsSchema = z.object({ id: objectIdParam }).strip();

export const followUpBodySchema = z.object({
  followUpStatus: z.enum(['new', 'contacted', 'interested', 'awaiting_payment', 'no_answer', 'not_interested', 'closed']),
  note: z.string().trim().max(1_000).optional(),
}).strip();
export const assignBodySchema = z.object({ assigneeId: objectId.nullable() }).strip();
export const confirmBodySchema = z.object({ reason: z.string().trim().min(3).max(1_000).optional() }).strip();
export const cancelBodySchema = z.object({ reason: z.string().trim().min(3).max(1_000) }).strip();
export const noteBodySchema = z.object({ body: z.string().max(5_000) }).strip();
export const listNotesQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strip();
export const notificationListQuerySchema = z.object({
  unreadOnly: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strip();

const paymentMethod = z.enum(['cash', 'bank_transfer', 'e_wallet', 'instapay', 'other']);
const paymentKind = z.enum(['payment', 'refund']);
const paymentRecordStatus = z.enum(['confirmed', 'voided']);
export const enrollmentPaymentParamsSchema = z.object({ id: objectIdParam }).strip();
export const paymentIdParamsSchema = z.object({ id: objectIdParam }).strip();
export const paymentListQuerySchema = z.object({
  dateFrom: isoDay.optional(), dateTo: isoDay.optional(), method: paymentMethod.optional(), kind: paymentKind.optional(),
  status: paymentRecordStatus.optional(), courseId: objectId.optional(), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25), sort: z.enum(['newest', 'oldest']).default('newest'),
}).strip().superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'تاريخ النهاية لازم يكون بعد تاريخ البداية.' });
});
export const recordPaymentBodySchema = z.object({
  kind: paymentKind, amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Za-z]{3}$/), method: paymentMethod,
  receivedAt: z.string().datetime({ offset: true }), reference: z.string().trim().max(200).optional(), note: z.string().trim().max(2_000).optional(),
  receiptMediaKey: z.string().regex(/^receipts\/\d{4}\/(?:0[1-9]|1[0-2])\/[A-Fa-f0-9]{40}\.(?:pdf|webp)$/i).optional(), idempotencyKey: z.string().trim().min(8).max(200),
}).strip().superRefine((value, context) => {
  if (value.kind === 'refund' && (value.note?.trim().length ?? 0) < 3) context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'سبب الاسترداد مطلوب.' });
});
export const voidPaymentBodySchema = z.object({ reason: z.string().trim().min(3).max(1_000) }).strip();
