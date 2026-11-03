import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({
  enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
  kind: { type: String, enum: ['payment', 'refund'], required: true },
  amount: { type: Number, required: true, min: 1, validate: { validator: Number.isSafeInteger, message: 'Amount must be a positive integer in minor units' } },
  currency: { type: String, required: true, uppercase: true, enum: ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD'] },
  method: { type: String, enum: ['cash', 'bank_transfer', 'e_wallet', 'instapay', 'other'], required: true },
  reference: { type: String, maxlength: 200 },
  note: { type: String, maxlength: 2000 },
  receiptMediaKey: { type: String, match: /^receipts\/\d{4}\/(?:0[1-9]|1[0-2])\/[A-Za-z0-9_-]{16,80}\.(?:pdf|webp)$/i },
  receivedAt: { type: Date, required: true },
  status: { type: String, enum: ['confirmed', 'voided'], default: 'confirmed', required: true, validate: { validator: function (this: mongoose.Document, value: string) { return !this.isNew || value === 'confirmed'; }, message: 'Payment records must be created as confirmed' } },
  voidedAt: Date,
  voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  voidReason: { type: String, trim: true, maxlength: 1000 },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  idempotencyKey: { type: String, required: true, maxlength: 200 },
  payloadHash: { type: String, match: /^[a-f0-9]{64}$/i, select: false, immutable: true },
}, strictOptions);
schema.index({ enrollmentId: 1, receivedAt: -1 });
schema.index({ idempotencyKey: 1 }, { unique: true });
schema.index({ status: 1, method: 1, kind: 1, receivedAt: -1 });
schema.index({ status: 1, currency: 1, receivedAt: 1, kind: 1 });
schema.index({ receivedAt: -1, _id: -1 });
const immutablePaths = new Set(['enrollmentId', 'kind', 'amount', 'currency', 'method', 'reference', 'note', 'receiptMediaKey', 'receivedAt', 'recordedBy', 'confirmedBy', 'idempotencyKey', 'payloadHash']);
schema.pre('save', async function () {
  if (this.isNew) {
    if (this.status !== 'confirmed') throw new Error('Payment records must be created as confirmed');
    return;
  }
  const changed = this.modifiedPaths();
  if (changed.some((path) => immutablePaths.has(path))) throw new Error('Payment records are immutable');
  if (changed.length === 0) return;
  const allowed = new Set(['status', 'voidedAt', 'voidedBy', 'voidReason', 'updatedAt']);
  if (changed.some((path) => !allowed.has(path)) || this.status !== 'voided' || !this.voidReason?.trim() || !this.voidedAt || !this.voidedBy) throw new Error('Only a confirmed payment may be voided once with a reason');
  const previous = await Payment.findById(this._id).select('status').lean();
  if (!previous || previous.status !== 'confirmed') throw new Error('Only a confirmed payment may be voided once');
});
schema.pre('updateMany', function () { throw new Error('Payment records cannot be changed with updateMany'); });
schema.pre(['replaceOne', 'findOneAndReplace'], function () { throw new Error('Payment records cannot be replaced'); });
schema.static('bulkWrite', async function () { throw new Error('Payment records cannot be bulk-mutated'); });
schema.pre(['updateOne', 'findOneAndUpdate'], async function () {
  const update = this.getUpdate();
  if (!update || Array.isArray(update)) throw new Error('Payment records are immutable');
  const set = update.$set;
  const setOnInsert = update.$setOnInsert;
  const hasOnlyTransitionOperators = Object.keys(update).every((key) => key === '$set' || key === '$setOnInsert');
  const hasOnlyTransitionFields = Boolean(set) && Object.keys(set ?? {}).every((key) => ['status', 'voidedAt', 'voidedBy', 'voidReason', 'updatedAt'].includes(key));
  const hasOnlyTimestampDefaults = Object.keys(setOnInsert ?? {}).every((key) => key === 'createdAt');
  if (!hasOnlyTransitionOperators || !hasOnlyTransitionFields || !hasOnlyTimestampDefaults || set?.status !== 'voided' || typeof set.voidReason !== 'string' || !set.voidReason.trim() || !set.voidedAt || !set.voidedBy) throw new Error('Payment records are immutable; only one confirmed-to-voided transition with a reason is allowed');
  const previous = await Payment.findOne(this.getQuery()).select('status').lean();
  if (!previous || previous.status !== 'confirmed') throw new Error('Only a confirmed payment may be voided once');
});
schema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () { throw new Error('Payment records cannot be deleted'); });
schema.pre('deleteOne', { document: true, query: false }, function () { throw new Error('Payment records cannot be deleted'); });
export type PaymentDocument = InferSchemaType<typeof schema>;
export const Payment = mongoose.models.Payment as mongoose.Model<PaymentDocument> | undefined ?? mongoose.model<PaymentDocument>('Payment', schema);
