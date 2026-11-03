import { z } from 'zod';
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }, 'اكتب تاريخ صحيح.');
export const auditQuerySchema = z.object({
  entityType: z.string().trim().min(1).max(80).optional(), entityId: objectId.optional(), actorId: objectId.optional(), action: z.string().trim().min(1).max(120).optional(),
  dateFrom: day.optional(), dateTo: day.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strip().superRefine((value, context) => { if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) context.addIssue({ code: 'custom', path: ['dateTo'], message: 'تاريخ النهاية لازم يكون بعد تاريخ البداية.' }); });
