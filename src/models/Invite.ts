import mongoose, { Schema, type HydratedDocument } from 'mongoose';
import { sha256Hash, strictOptions } from './common';

export interface InviteFields {
  tokenHash: string; email: string; role: 'admin' | 'assistant'; permissions: string[];
  invitedBy: mongoose.Types.ObjectId; expiresAt: Date; purgeAt: Date; usedAt: Date | null;
  revokedAt: Date | null; createdAt: Date; updatedAt: Date;
}
const schema = new Schema<InviteFields>({
  tokenHash: sha256Hash,
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, index: true },
  role: { type: String, enum: ['admin', 'assistant'], required: true },
  permissions: { type: [String], enum: ['viewLeads', 'updateFollowUp', 'viewPayments', 'recordPayments', 'exportCsv', 'viewFinancialReports', 'manageNotes', 'viewSettings'], default: [] },
  invitedBy: { ...{ type: Schema.Types.ObjectId, ref: 'User' }, required: true },
  expiresAt: { type: Date, required: true },
  purgeAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, strictOptions);
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ email: 1, createdAt: -1 });
schema.pre('validate', function () { this.purgeAt = new Date(this.expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000); });
export type InviteDocument = HydratedDocument<InviteFields>;
export const Invite = (mongoose.models.Invite as mongoose.Model<InviteFields> | undefined) ?? mongoose.model<InviteFields>('Invite', schema);
