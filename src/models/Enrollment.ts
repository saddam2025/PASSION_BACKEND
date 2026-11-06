import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const bilingualTextSchema = new Schema({ ar: { type: String, required: true, trim: true }, en: { type: String, required: false, trim: true } }, { _id: false, strict: 'throw' });
const formFieldSnapshotSchema = new Schema({ id: { type: String, required: true }, label: { type: bilingualTextSchema, required: true }, type: { type: String, required: true } }, { _id: false, strict: 'throw' });
const historySchema = new Schema({ at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User', required: true }, from: String, to: String, note: { type: String, maxlength: 2000 } }, { _id: false, strict: 'throw' });
const paymentSummarySchema = new Schema({ netMinor: { type: Number, min: 0, default: 0, required: true }, currency: { type: String, uppercase: true, enum: ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD'] }, status: { type: String, enum: ['unpaid', 'pending', 'partially_paid', 'paid', 'cancelled', 'refunded', 'partially_refunded'], default: 'unpaid', required: true }, lastPaymentAt: { type: Date, default: null } }, { _id: false, strict: 'throw' });
const schema = new Schema({
  reference: { type: String, required: true, unique: true, match: /^PAS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/ },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  courseSnapshot: { title: { type: bilingualTextSchema, required: true }, slug: { type: String, required: true } },
  priceSnapshot: { amount: { type: Number, min: 0, default: null }, currency: { type: String, required: true, uppercase: true, enum: ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD'] } },
  audience: { type: String, enum: ['egyptian', 'foreign'], default: 'egyptian', required: true },
  consent: { acceptedAt: { type: Date, required: true }, policyVersion: { type: Number, required: true, min: 0 } },
  formSnapshot: { fields: { type: [formFieldSnapshotSchema], default: [] } },
  answers: { type: Map, of: Schema.Types.Mixed, default: {} },
  enrollmentStatus: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending', required: true, index: true },
  followUpStatus: { type: String, enum: ['new', 'contacted', 'interested', 'awaiting_payment', 'no_answer', 'not_interested', 'closed'], default: 'new', required: true },
  isActive: { type: Boolean, default: true, required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledReason: { type: String, maxlength: 1000 },
  history: { type: [historySchema], default: [] },
  registeredAt: { type: Date, default: Date.now, required: true },
  idempotencyKey: { type: String, required: true, maxlength: 200 },
  idempotencyHash: { type: String, match: /^[a-f0-9]{64}$/i, select: false },
  paymentSummary: { type: paymentSummarySchema, default: () => ({ netMinor: 0, status: 'unpaid', lastPaymentAt: null }) },
}, strictOptions);
schema.index({ idempotencyKey: 1 }, { unique: true });
schema.index({ leadId: 1, courseId: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
schema.index({ courseId: 1, enrollmentStatus: 1, registeredAt: -1 });
schema.index({ audience: 1, registeredAt: -1 });
schema.index({ registeredAt: 1, courseId: 1, 'paymentSummary.status': 1 });
schema.index({ leadId: 1, registeredAt: -1 });
schema.index({ 'paymentSummary.status': 1, registeredAt: -1 });
schema.pre('validate', function () { this.isActive = this.enrollmentStatus === 'pending' || this.enrollmentStatus === 'confirmed'; });
schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
  const update = this.getUpdate();
  if (!update || Array.isArray(update)) return;
  const status = update.$set?.enrollmentStatus ?? update.enrollmentStatus;
  if (status === 'pending' || status === 'confirmed' || status === 'cancelled') {
    update.$set = { ...update.$set, isActive: status !== 'cancelled' };
    this.setUpdate(update);
  }
});
export type EnrollmentDocument = InferSchemaType<typeof schema>;
export const Enrollment = mongoose.models.Enrollment as mongoose.Model<EnrollmentDocument> | undefined ?? mongoose.model<EnrollmentDocument>('Enrollment', schema);
