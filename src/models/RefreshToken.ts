import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { sha256Hash, strictOptions } from './common';

const schema = new Schema({ tokenHash: sha256Hash, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, familyId: { type: String, required: true, index: true }, tokenVersion: { type: Number, min: 0, default: 0 }, expiresAt: { type: Date, required: true }, usedAt: { type: Date, default: null }, revokedAt: { type: Date, default: null } }, strictOptions);
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type RefreshTokenDocument = InferSchemaType<typeof schema>;
export const RefreshToken = mongoose.models.RefreshToken as mongoose.Model<RefreshTokenDocument> | undefined ?? mongoose.model<RefreshTokenDocument>('RefreshToken', schema);
