import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { sha256Hash, strictOptions } from './common';

const schema = new Schema({ tokenHash: sha256Hash, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, expiresAt: { type: Date, required: true }, usedAt: { type: Date, default: null } }, strictOptions);
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type PasswordResetDocument = InferSchemaType<typeof schema>;
export const PasswordReset = mongoose.models.PasswordReset as mongoose.Model<PasswordResetDocument> | undefined ?? mongoose.model<PasswordResetDocument>('PasswordReset', schema);
