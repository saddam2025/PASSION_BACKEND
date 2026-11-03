import { z } from 'zod';

export const SafeUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
    if (/^#[\w-]+$/.test(value)) return true;
    try {
      const url = new URL(value);
      return (
        ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ||
        (url.protocol === 'https:' && ['wa.me', 'api.whatsapp.com'].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, 'Use an allowed http(s), mailto, tel, WhatsApp or same-origin path URL.');

const placeholders = new Set(['name', 'course', 'reference']);
const forbiddenKeys = /(?:password|token|secret|authorization)/i;
const imageKey = /(?:^src$|image|logo|favicon|ogImage)/i;
const relativeImage =
  /^(?:media\/\d{4}\/\d{2}\/[A-Za-z0-9_-]+\.(?:webp|jpe?g|png|avif)|\/images\/[A-Za-z0-9_./-]+)$/;
export function validateSettingsSection(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  if (json.length > 100_000) throw new Error('Settings section is too large');
  const visit = (entry: unknown, field = ''): void => {
    if (entry && typeof entry === 'object') {
      for (const [childKey, childValue] of Object.entries(entry)) {
        if (forbiddenKeys.test(childKey))
          throw new Error('Sensitive values cannot be saved in settings');
        visit(childValue, childKey);
      }
      return;
    }
    if (typeof entry !== 'string') return;
    if (/<\/?(?:script|iframe|style|html)[\s>]/i.test(entry) || /javascript:/i.test(entry))
      throw new Error('HTML and executable content are not allowed in settings');
    if (imageKey.test(field) && entry && !relativeImage.test(entry))
      throw new Error('Images must use a relative media key or /images path');
    if (
      /(?:url|link|href|map|facebook|instagram|youtube|tiktok|linkedin|^x$)/i.test(field) &&
      entry
    )
      SafeUrlSchema.parse(entry);
    if (/email/i.test(field) && entry && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))
      throw new Error('Enter a valid email address');
    if (
      /(?:whatsappNumber|phone)/i.test(field) &&
      entry &&
      !/^\+[1-9]\d{7,14}$/.test(entry.replace(/[\s()-]/g, ''))
    )
      throw new Error('Enter an international phone number');
    if (/(?:template|message|greeting)/i.test(key)) {
      for (const [, name] of entry.matchAll(/\{([^{}]+)\}/g))
        if (!placeholders.has(name ?? '')) throw new Error(`Unknown message placeholder: ${name}`);
    }
  };
  visit(value);
}
