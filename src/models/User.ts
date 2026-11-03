import mongoose, { Schema, type HydratedDocument } from 'mongoose';
import { strictOptions } from './common';

export interface UserFields {
  email: string; name: string; passwordHash: string; role: 'admin' | 'assistant';
  permissions: Record<string, boolean>; isActive: boolean; failedLoginCount: number;
  settingsPermissionsApplied: boolean;
  lockedUntil: Date | null; lastLoginAt: Date | null; tokenVersion: number;
  createdAt: Date; updatedAt: Date;
}
const userSchema = new Schema<UserFields>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  passwordHash: { type: String, required: true, minlength: 20, select: false },
  role: { type: String, enum: ['admin', 'assistant'], required: true },
  permissions: { viewLeads: { type: Boolean, default: false }, updateFollowUp: { type: Boolean, default: false }, viewPayments: { type: Boolean, default: false }, recordPayments: { type: Boolean, default: false }, exportCsv: { type: Boolean, default: false }, viewFinancialReports: { type: Boolean, default: false }, manageNotes: { type: Boolean, default: false }, viewSettings: { type: Boolean, default: false } },
  settingsPermissionsApplied: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
  failedLoginCount: { type: Number, min: 0, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  tokenVersion: { type: Number, min: 0, default: 0 },
}, { ...strictOptions, versionKey: false, toJSON: { transform: (_doc, ret) => { const output = ret as Record<string, unknown>; for (const key of Object.keys(output)) if (/(?:password|token|secret)/i.test(key)) delete output[key]; return ret; } }, toObject: { transform: (_doc, ret) => { const output = ret as Record<string, unknown>; for (const key of Object.keys(output)) if (/(?:password|token|secret)/i.test(key)) delete output[key]; return ret; } } });

export type UserDocument = HydratedDocument<UserFields>;
export const User = (mongoose.models.User as mongoose.Model<UserFields> | undefined) ?? mongoose.model<UserFields>('User', userSchema);
