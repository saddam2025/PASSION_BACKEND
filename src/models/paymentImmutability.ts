import type { Types } from 'mongoose';
import { Payment } from './Payment';

export async function voidConfirmedPayment(paymentId: Types.ObjectId | string, actorId: Types.ObjectId | string, reason: string) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('A reason is required to void a payment');
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: 'confirmed' },
    { $set: { status: 'voided', voidedAt: new Date(), voidedBy: actorId, voidReason: normalizedReason } },
    { new: true, runValidators: true },
  );
  if (!payment) throw new Error('Only a confirmed payment may be voided once');
  return payment;
}
