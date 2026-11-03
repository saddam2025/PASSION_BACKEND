import type { PaymentStatus } from '../shared/schemas/payment';

export type DerivedPaymentStatus = Exclude<PaymentStatus, 'failed'>;
export interface PaymentStatusEnrollment {
  enrollmentStatus: 'pending' | 'confirmed' | 'cancelled';
  priceSnapshot: { amount: number | null; currency: string };
}
export interface PaymentStatusRecord {
  kind: 'payment' | 'refund';
  amount: number;
  status: 'pending' | 'confirmed' | 'voided';
}

export function confirmedNet(records: readonly PaymentStatusRecord[]): number {
  return records.filter((record) => record.status === 'confirmed')
    .reduce((sum, record) => sum + (record.kind === 'payment' ? record.amount : -record.amount), 0);
}

export function derivePaymentStatus(enrollment: PaymentStatusEnrollment, records: readonly PaymentStatusRecord[]): DerivedPaymentStatus {
  if (enrollment.enrollmentStatus === 'cancelled') return 'cancelled';
  const active = records.filter((record) => record.status !== 'voided');
  if (!active.length) return 'unpaid';
  const confirmed = active.filter((record) => record.status === 'confirmed');
  if (!confirmed.length) return 'pending';

  const payments = confirmed.filter((record) => record.kind === 'payment').reduce((sum, record) => sum + record.amount, 0);
  const refunds = confirmed.filter((record) => record.kind === 'refund').reduce((sum, record) => sum + record.amount, 0);
  const net = payments - refunds;
  if (refunds > 0) return net <= 0 ? 'refunded' : 'partially_refunded';
  if (payments === 0) return 'unpaid';
  // A contact-us price has no amount threshold: confirmed funds remain pending until a price exists.
  if (enrollment.priceSnapshot.amount === null) return 'pending';
  return net >= enrollment.priceSnapshot.amount ? 'paid' : net > 0 ? 'partially_paid' : 'unpaid';
}

export function outstandingAmount(enrollment: PaymentStatusEnrollment, records: readonly PaymentStatusRecord[]): number | null {
  if (enrollment.priceSnapshot.amount === null) return null;
  return Math.max(enrollment.priceSnapshot.amount - confirmedNet(records), 0);
}
