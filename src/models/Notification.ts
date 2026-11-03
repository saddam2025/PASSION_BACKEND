import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['course_submitted', 'course_withdrawn', 'course_published', 'course_unpublished', 'revision_approved', 'revision_rejected', 'lead_created', 'enrollment_created', 'new_registration', 'payment_recorded', 'system'], required: true },
  params: { type: Map, of: Schema.Types.Mixed, default: {} },
  entityType: { type: String, enum: ['course', 'lead', 'enrollment', 'payment', 'system'], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  readAt: { type: Date, default: null },
}, strictOptions);
schema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
export type NotificationDocument = InferSchemaType<typeof schema>;
export const Notification = mongoose.models.Notification as mongoose.Model<NotificationDocument> | undefined ?? mongoose.model<NotificationDocument>('Notification', schema);
