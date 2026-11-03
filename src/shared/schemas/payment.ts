import { z } from 'zod';
import { BilingualTextSchema } from './sections/common';
export const PaymentStatusSchema = z.enum([
  'unpaid',
  'pending',
  'partially_paid',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export const PaymentRecordSchema = z
  .object({
    id: z.string(),
    enrollmentId: z.string(),
    kind: z.enum(['payment', 'refund']),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    method: z.enum(['cash', 'bank_transfer', 'e_wallet', 'instapay', 'other']),
    reference: z.string().optional(),
    note: z.string().optional(),
    receipt: z
      .object({
        assetId: z.string().optional(),
        src: z.string(),
        alt: BilingualTextSchema,
        decorative: z.boolean().optional(),
      })
      .optional(),
    receivedAt: z.string(),
    status: z.enum(['pending', 'confirmed', 'voided']),
    voidReason: z.string().optional(),
    recordedBy: z.string(),
    confirmedBy: z.string().optional(),
    confirmedAt: z.string().optional(),
    createdAt: z.string(),
    idempotencyKey: z.string(),
    isDemo: z.literal(true).optional(),
  })
  .strict();
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;
export interface PriceSnapshot {
  amount: number | null;
  currency: string;
}
export function computePaymentStatus(
  price: PriceSnapshot,
  records: readonly PaymentRecord[],
  cancelled = false,
): PaymentStatus {
  const active = records.filter((r) => r.status !== 'voided');
  if (!active.length) return cancelled ? 'cancelled' : 'unpaid';
  const confirmed = active.filter((r) => r.status === 'confirmed');
  if (!confirmed.length) return 'pending';
  const paid = confirmed.filter((r) => r.kind === 'payment').reduce((sum, r) => sum + r.amount, 0);
  const refunded = confirmed
    .filter((r) => r.kind === 'refund')
    .reduce((sum, r) => sum + r.amount, 0);
  const net = paid - refunded;
  if (refunded > 0) return net <= 0 ? 'refunded' : net < paid ? 'partially_refunded' : 'paid';
  if (cancelled && net === 0) return 'cancelled';
  if (price.amount !== null && net >= price.amount) return 'paid';
  return net > 0 ? 'partially_paid' : 'unpaid';
}
export function outstanding(
  price: PriceSnapshot,
  records: readonly PaymentRecord[],
): number | null {
  if (price.amount === null) return null;
  const net = records
    .filter((r) => r.status === 'confirmed')
    .reduce((sum, r) => sum + (r.kind === 'payment' ? r.amount : -r.amount), 0);
  return Math.max(price.amount - net, 0);
}
