import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({
  key: { type: String, default: 'academy', enum: ['academy'] },
  academyName: { ar: { type: String, required: true }, en: { type: String } },
  tagline: { ar: { type: String, default: '' }, en: { type: String } },
  logoKey: String,
  faviconKey: String,
  contact: { whatsappNumber: String, phone: String, email: String, address: { ar: String, en: String }, hours: { ar: String, en: String }, mapLink: String },
  socialLinks: { type: Map, of: String, default: {} },
  messageTemplates: { type: Map, of: String, default: {} },
  registration: { privacyUrl: String, confirmationNote: { ar: String, en: String } },
  defaultCurrency: { type: String, required: true, uppercase: true, enum: ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD'] },
  enabledCurrencies: { type: [String], enum: ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD'], default: ['EGP'] },
  acceptedPaymentMethods: { type: [String], enum: ['cash', 'bank_transfer', 'e_wallet', 'instapay', 'other'], default: [] },
  paymentInstructions: { ar: String, en: String },
  legalPages: { type: Map, of: new Schema({ title: { ar: { type: String, required: true }, en: String }, body: { ar: { type: String, required: true }, en: String }, policyVersion: { type: Number, required: true, min: 0 } }, { _id: false, strict: 'throw' }), default: {} },
  seoDefaults: { title: { ar: String, en: String }, description: { ar: String, en: String }, titleTemplate: String, ogImage: String, allowSearchEngines: { type: Boolean, default: true } },
  staffDefaultPermissions: { type: [String], enum: ['viewLeads', 'updateFollowUp', 'viewPayments', 'recordPayments', 'exportCsv', 'viewFinancialReports', 'manageNotes', 'viewSettings'], default: ['viewLeads', 'updateFollowUp', 'viewPayments', 'manageNotes'] },
  version: { type: Number, min: 0, default: 0 },
}, { ...strictOptions, versionKey: 'version', optimisticConcurrency: true });
schema.index({ key: 1 }, { unique: true });
export type SettingsDocument = InferSchemaType<typeof schema>;
export const Settings = mongoose.models.Settings as mongoose.Model<SettingsDocument> | undefined ?? mongoose.model<SettingsDocument>('Settings', schema);
