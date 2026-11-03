import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 160 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  phone: { type: String, required: true, trim: true, maxlength: 32 },
  phoneNormalized: { type: String, required: true, maxlength: 20, match: /^\d{7,20}$/ },
  consent: { acceptedAt: { type: Date, required: true }, policyVersion: { type: Number, required: true, min: 0 } },
  attribution: { source: String, medium: String, campaign: String, referrer: String, referrerPath: String, landingSlug: String },
  possibleDuplicateOf: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
}, strictOptions);
schema.index({ email: 1 }, { unique: true });
schema.index({ phoneNormalized: 1 });
export type LeadDocument = InferSchemaType<typeof schema>;
export const Lead = mongoose.models.Lead as mongoose.Model<LeadDocument> | undefined ?? mongoose.model<LeadDocument>('Lead', schema);
