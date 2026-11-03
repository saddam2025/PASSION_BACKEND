import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 120 },
  entityType: { type: String, required: true, maxlength: 80 },
  entityId: { type: Schema.Types.ObjectId, required: true },
  beforeStatus: { type: String, maxlength: 80 },
  afterStatus: { type: String, maxlength: 80 },
  note: { type: String, maxlength: 2000 },
  occurredAt: { type: Date, required: true, default: Date.now },
}, strictOptions);
schema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
schema.index({ actorId: 1, occurredAt: -1 });
schema.index({ occurredAt: -1, _id: -1 });
const immutable = () => { throw new Error('Audit log records are append-only'); };
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], immutable);
schema.pre(['replaceOne', 'findOneAndReplace'], immutable);
schema.static('bulkWrite', async function () { throw new Error('Audit log records are append-only'); });
schema.pre('save', function () { if (!this.isNew) immutable(); });
schema.pre('deleteOne', { document: true, query: false }, immutable);
export type AuditLogDocument = InferSchemaType<typeof schema>;
export const AuditLog = mongoose.models.AuditLog as mongoose.Model<AuditLogDocument> | undefined ?? mongoose.model<AuditLogDocument>('AuditLog', schema);
