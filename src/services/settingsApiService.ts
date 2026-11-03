/* eslint-disable @typescript-eslint/no-explicit-any */
import sanitizeHtml from 'sanitize-html';
import type pino from 'pino';
import { Settings } from '../models/Settings';
import { Media } from '../models/Media';
import { ConflictError, ValidationError } from '../lib/errors';
import { withTransaction } from '../lib/withTransaction';
import { writeAudit } from './audit';
import type { MediaService } from './mediaService';

const legalSanitize = (html: string) => sanitizeHtml(html, { allowedTags: ['p','br','strong','em','ul','ol','li','a','h2','h3'], allowedAttributes: { a: ['href'] }, allowedSchemes: ['http','https','mailto','tel'], allowProtocolRelative: false });
const plainTemplate = (value: string) => { if (/<[^>]*>|\{(?!name\}|course\}|reference\})[^}]*\}/i.test(value)) throw new ValidationError('قالب الرسالة يحتوي على محتوى أو متغير غير مسموح.'); return value; };

export async function readSettings() {
  const existing = await Settings.findOne({ key: 'academy' });
  if (existing) return existing;
  try { return await Settings.create({ key: 'academy', academyName: { ar: 'الأكاديمية' }, defaultCurrency: 'EGP' }); }
  catch (error) { if ((error as any)?.code === 11000) { const raced = await Settings.findOne({ key: 'academy' }); if (raced) return raced; } throw error; }
}
const mapObject = (value: unknown) => value instanceof Map ? Object.fromEntries(value) : (value ?? {});
export function publicSettings(s: any) {
  const storedTemplates = mapObject(s.messageTemplates) as Record<string, unknown>;
  const candidate = storedTemplates.registration;
  const whatsappMessageTemplate = typeof candidate === 'string' && !/<[^>]*>|\{(?!name\}|course\}|reference\})[^}]*\}/i.test(candidate)
    ? candidate
    : 'أهلًا {name}، بخصوص حجزك في {course} (رقم الطلب {reference}).';
  return { academyName: s.academyName?.ar ?? '', logoKey: s.logoKey ?? null,
    contact: { whatsappNumber: s.contact?.whatsappNumber ?? '', phone: s.contact?.phone ?? '', email: s.contact?.email ?? '', address: s.contact?.address?.ar ?? '', openingHours: s.contact?.hours?.ar ?? '' },
    socialLinks: mapObject(s.socialLinks), defaultCurrency: s.defaultCurrency,
    seoDefaults: { title: s.seoDefaults?.title?.ar ?? '', description: s.seoDefaults?.description?.ar ?? '', titleTemplate: s.seoDefaults?.titleTemplate ?? '', ogImage: s.seoDefaults?.ogImage ?? '' },
    whatsappMessageTemplate,
    legalPages: Object.fromEntries(Object.entries(mapObject(s.legalPages) as Record<string, any>).map(([key, page]) => [key,{ title: page.title?.ar ?? '', body: page.body?.ar ?? '', policyVersion: page.policyVersion }])) };
}
export function staffSettings(s: any) {
  return { version: s.version, academy: { name: s.academyName?.ar ?? '', tagline: s.tagline?.ar ?? '', logo: s.logoKey ?? '', favicon: s.faviconKey ?? '' },
    contact: { whatsappNumber: s.contact?.whatsappNumber ?? '', phone: s.contact?.phone ?? '', email: s.contact?.email ?? '', address: s.contact?.address?.ar ?? '', openingHours: s.contact?.hours?.ar ?? '', mapLink: s.contact?.mapLink ?? '' },
    social: mapObject(s.socialLinks), messaging: mapObject(s.messageTemplates), registration: { privacyUrl: s.registration?.privacyUrl ?? '', confirmationNote: s.registration?.confirmationNote?.ar ?? '' },
    payments: { defaultCurrency: s.defaultCurrency, enabledCurrencies: s.enabledCurrencies, methods: Object.fromEntries((s.acceptedPaymentMethods ?? []).map((m: string) => [m,true])), instructions: s.paymentInstructions?.ar ?? '' },
    legal: Object.fromEntries(Object.entries(mapObject(s.legalPages) as Record<string, any>).map(([key, page]) => [key,{ title: page.title?.ar ?? '', body: page.body?.ar ?? '', policyVersion: page.policyVersion }])),
    seo: { titleTemplate: s.seoDefaults?.titleTemplate ?? '', title: s.seoDefaults?.title?.ar ?? '', description: s.seoDefaults?.description?.ar ?? '', ogImage: s.seoDefaults?.ogImage ?? '', allowSearchEngines: s.seoDefaults?.allowSearchEngines ?? true } };
}

export async function patchSettings(input: { expectedVersion: number; section: string; value: any }, actorId: string, media: MediaService, logger: pino.Logger) {
  const current = await readSettings();
  if (current.version !== input.expectedVersion) throw new ConflictError('الإعدادات اتحدثت من مستخدم تاني.', { currentVersion: current.version });
  const section = input.section; const value = input.value;
  if (section === 'messaging') for (const text of Object.values(value) as string[]) plainTemplate(text);
  let saved: any;
  await withTransaction(async (session) => {
    const doc = await Settings.findOne({ key: 'academy' }).session(session);
    if (!doc || doc.version !== input.expectedVersion) throw new ConflictError('الإعدادات اتحدثت من مستخدم تاني.', { currentVersion: doc?.version ?? null });
    if (section === 'academy') {
      doc.academyName = { ar: value.name.ar }; doc.tagline = { ar: value.tagline?.ar ?? '' };
      const oldKey = doc.logoKey; const newKey = value.logo;
      if (newKey !== undefined && newKey !== oldKey) {
        if (oldKey) { const old = await Media.findOne({ key: oldKey, bucket: 'public' }).session(session); if (old) await media.removeUsage(String(old._id), { entityType: 'settings', entityId: String(doc._id), field: 'logoKey' }, session); }
        if (newKey) { const next = await Media.findOne({ key: newKey, bucket: 'public' }).session(session); if (!next) throw new ValidationError('اختار صورة موجودة في مكتبة الوسائط.'); await media.addUsage(String(next._id), { entityType: 'settings', entityId: String(doc._id), field: 'logoKey' }, session); doc.logoKey = newKey; }
        else doc.logoKey = null;
      }
      if (value.favicon !== undefined) doc.faviconKey = value.favicon || undefined;
    } else if (section === 'contact') doc.contact = { ...(doc.contact ?? {}), whatsappNumber: value.whatsappNumber, phone: value.phone, email: value.email, ...(value.address ? { address: { ar: value.address.ar } } : {}), ...(value.openingHours ? { hours: { ar: value.openingHours.ar } } : {}), ...(value.mapLink !== undefined ? { mapLink: value.mapLink } : {}) } as any;
    else if (section === 'social') doc.socialLinks = new Map(Object.entries(value));
    else if (section === 'messaging') doc.messageTemplates = new Map(Object.entries(value));
    else if (section === 'registration') doc.registration = { ...(value.privacyUrl !== undefined ? { privacyUrl: value.privacyUrl } : {}), ...(value.confirmationNote ? { confirmationNote: { ar: value.confirmationNote.ar } } : {}) } as any;
    else if (section === 'payments') { doc.defaultCurrency = value.defaultCurrency; doc.enabledCurrencies = value.enabledCurrencies; doc.acceptedPaymentMethods = Object.entries(value.methods ?? {}).filter(([, enabled]) => enabled).map(([method]) => method) as any; if (value.instructions) doc.paymentInstructions = { ar: value.instructions.ar }; }
    else if (section === 'seo') doc.seoDefaults = { ...(doc.seoDefaults ?? {}), ...(value.titleTemplate !== undefined ? { titleTemplate: value.titleTemplate } : {}), ...(value.title ? { title: { ar: value.title.ar } } : {}), ...(value.description ? { description: { ar: value.description.ar } } : {}), ...(value.ogImage !== undefined ? { ogImage: value.ogImage } : {}), ...(value.allowSearchEngines !== undefined ? { allowSearchEngines: value.allowSearchEngines } : {}) } as any;
    else if (section === 'legal') {
      const pages = new Map(doc.legalPages ?? []);
      for (const [key, page] of Object.entries(value) as Array<[string, any]>) {
        const title = page.title.ar; const body = legalSanitize(page.body.ar); const before = pages.get(key) as any;
        pages.set(key, { title: { ar: title }, body: { ar: body }, policyVersion: (before?.policyVersion ?? 0) + (before && before.title?.ar === title && before.body?.ar === body ? 0 : 1) });
      }
      doc.legalPages = pages;
    }
    try { saved = await doc.save({ session }); } catch (e) { if ((e as any)?.name === 'VersionError') throw new ConflictError('الإعدادات اتحدثت من مستخدم تاني.'); throw e; }
  });
  await writeAudit({ actorId, action: 'settings_updated', entityType: 'settings', entityId: String(saved._id), note: `section:${section}` }, logger);
  return staffSettings(saved);
}
