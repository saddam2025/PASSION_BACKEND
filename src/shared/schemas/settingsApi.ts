import { z } from 'zod';
import { PermissionKeySchema, PermissionListSchema } from './permissions';
import { SafeUrlSchema } from './settings';

const text = (max = 6000) => z.string().trim().max(max);
const messageText = text(2000).refine((value) => !/<[^>]*>|\{(?!name\}|course\}|reference\})[^}]*\}/i.test(value), 'قالب الرسالة يقبل نص عادي والمتغيرات المعروفة بس.');
const arText = (max = 6000) => z.object({ ar: text(max), en: z.string().optional() }).strip();
const imageKey = z.string().trim().max(240).regex(/^(?:media\/\d{4}\/(?:0[1-9]|1[0-2])\/[A-Za-z0-9_-]{16,80}\.webp|\/images\/[A-Za-z0-9_./-]+)$/i);
const optionalUrl = z.string().trim().max(2048).refine((value) => !value || SafeUrlSchema.safeParse(value).success, 'رابط غير مسموح.');
const currency = z.enum(['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD']);
const paymentMethod = z.enum(['cash', 'bank_transfer', 'e_wallet', 'instapay', 'other']);
const normalizePhone = (value: string) => value.replace(/[^\d]/g, '');
const internationalPhone = z.string().trim().max(32).transform(normalizePhone).refine((value) => /^[1-9]\d{7,14}$/.test(value), 'رقم الهاتف لازم يكون بصيغة دولية.');

export const settingsSectionSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('academy'), value: z.object({ name: arText(160), tagline: arText(500).optional(), logo: imageKey.or(z.literal('')).optional(), favicon: imageKey.or(z.literal('')).optional() }).strip() }).strip(),
  z.object({ section: z.literal('contact'), value: z.object({ whatsappNumber: internationalPhone.optional(), phone: internationalPhone.optional(), email: z.string().trim().email().max(254).or(z.literal('')).optional(), address: arText(2000).optional(), openingHours: arText(2000).optional(), mapLink: optionalUrl.optional() }).strip() }).strip(),
  z.object({ section: z.literal('social'), value: z.record(z.string().trim().max(40), optionalUrl) }).strip(),
  z.object({ section: z.literal('messaging'), value: z.record(z.string().trim().max(60), messageText) }).strip(),
  z.object({ section: z.literal('registration'), value: z.object({ privacyUrl: optionalUrl.optional(), confirmationNote: arText(2000).optional() }).strip() }).strip(),
  z.object({ section: z.literal('payments'), value: z.object({ defaultCurrency: currency, enabledCurrencies: z.array(currency).min(1).max(11), methods: z.record(paymentMethod, z.boolean()).optional(), instructions: arText(2000).optional() }).strip().superRefine((value, context) => { if (!value.enabledCurrencies.includes(value.defaultCurrency)) context.addIssue({ code: 'custom', path: ['defaultCurrency'], message: 'العملة الافتراضية لازم تكون ضمن العملات المفعلة.' }); }) }).strip(),
  z.object({ section: z.literal('seo'), value: z.object({ titleTemplate: text(180).optional(), title: arText(180).optional(), description: arText(500).optional(), ogImage: imageKey.optional(), allowSearchEngines: z.boolean().optional() }).strip() }).strip(),
  z.object({ section: z.literal('legal'), value: z.record(z.enum(['privacyPolicy', 'terms']), z.object({ title: arText(180), body: arText(20_000) }).strip()) }).strip(),
]);
export const settingsPatchBodySchema = z.object({ expectedVersion: z.number().int().nonnegative(), section: z.enum(['academy','contact','social','messaging','registration','payments','seo','legal']), value: z.unknown() }).strip();

export const settingsQueryEmptySchema = z.object({}).strip();

export const permissionKeysOnlySchema = PermissionListSchema;
export const knownPermissionSchema = PermissionKeySchema;
