import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const usageSchema = new Schema({ entityType: { type: String, enum: ['course', 'settings', 'payment'], required: true }, entityId: { type: Schema.Types.ObjectId, required: true }, field: { type: String, required: true, maxlength: 160 } }, { _id: false, strict: 'throw' });
const variantSchema = new Schema({ name: { type: String, enum: ['thumb', 'medium', 'large', 'original'], required: true }, key: { type: String, required: true }, width: { type: Number, min: 1, required: true }, height: { type: Number, min: 1, required: true }, mime: { type: String, required: true } }, { _id: false, strict: 'throw' });
const schema = new Schema({
  key: { type: String, required: true, unique: true, match: /^(?:media|receipts)\/\d{4}\/(?:0[1-9]|1[0-2])\/[A-Za-z0-9_-]{16,80}\.(?:webp|pdf)$/i },
  bucket: { type: String, enum: ['public', 'private'], required: true },
  mime: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  size: { type: Number, required: true, min: 1 }, width: { type: Number, min: 1 }, height: { type: Number, min: 1 },
  displayName: { type: String, trim: true, maxlength: 160 },
  variants: { type: [variantSchema], default: [] }, usages: { type: [usageSchema], default: [] },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, strictOptions);
schema.pre('validate', function () {
  if (this.bucket === 'public' && (!this.key.startsWith('media/') || this.mime === 'application/pdf')) this.invalidate('bucket', 'Public media must be a re-encoded image.');
  if (this.bucket === 'private' && !this.key.startsWith('receipts/')) this.invalidate('key', 'Private media must use a receipt key.');
});
schema.index({ bucket: 1, createdAt: -1 });
schema.index({ 'usages.entityType': 1, 'usages.entityId': 1 });
export type MediaDocument = InferSchemaType<typeof schema>;
export const Media = mongoose.models.Media as mongoose.Model<MediaDocument> | undefined ?? mongoose.model<MediaDocument>('Media', schema);
