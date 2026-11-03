import type { AppEnvironment } from '../config/env';
import { Course } from '../models/Course';
import { Settings } from '../models/Settings';

type TextValue = { ar?: string };
type CourseSeoSnapshot = { title?: TextValue; description?: TextValue; noindex?: boolean; ogImage?: unknown };
type CourseDetailSnapshot = { title?: TextValue; shortDescription?: TextValue; coverImage?: unknown };

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const text = (value: unknown): string => typeof value === 'string' ? value : '';
function imageSource(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'src' in value) return text((value as { src?: unknown }).src);
  return '';
}
function absoluteImage(key: string, environment: AppEnvironment): string {
  const base = environment.R2_PUBLIC_BASE_URL ?? environment.APP_BASE_URL;
  return new URL(key.replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`).toString();
}
function day(value?: Date | string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export const seoService = {
  async coursePage(slug: string, environment: AppEnvironment) {
    const course = await Course.findOne({ $or: [{ slug }, { slugHistory: slug }], status: 'published', published: { $ne: null } })
      .select('slug published publishedAt').lean() as { slug: string; published: { details?: CourseDetailSnapshot; seo?: CourseSeoSnapshot }; publishedAt?: Date } | null;
    if (!course) return null;
    const settings = await Settings.findOne({ key: 'academy' }).select('academyName seoDefaults').lean();
    const details = course.published.details ?? {};
    const seo = course.published.seo ?? {};
    const base = environment.APP_BASE_URL.replace(/\/+$/, '');
    const canonical = `${base}/ar/courses/${encodeURIComponent(course.slug)}`;
    const title = text(seo.title?.ar) || text(details.title?.ar) || 'الكورسات';
    const description = text(seo.description?.ar) || text(details.shortDescription?.ar) || '';
    const imageKey = imageSource(seo.ogImage) || imageSource(details.coverImage) || text(settings?.seoDefaults?.ogImage);
    const image = imageKey ? absoluteImage(imageKey, environment) : '';
    const siteName = text(settings?.academyName?.ar) || 'الأكاديمية';
    const robots = seo.noindex === true ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">';
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:locale" content="ar_EG"><meta property="og:site_name" content="${escapeHtml(siteName)}">${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}<meta name="twitter:card" content="summary_large_image">${robots}<meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}"></head><body><p>جارٍ فتح صفحة الكورس. <a href="${escapeHtml(canonical)}">افتح الصفحة</a>.</p></body></html>`;
    return { html, canonical, noindex: seo.noindex === true };
  },

  async sitemap(environment: AppEnvironment) {
    const base = environment.APP_BASE_URL.replace(/\/+$/, '');
    const rows = await Course.find({ status: 'published', published: { $ne: null }, 'published.seo.noindex': { $ne: true } })
      .select('slug publishedAt').sort({ publishedAt: -1, slug: 1 }).lean() as Array<{ slug: string; publishedAt?: Date }>;
    const urls = [
      `<url><loc>${escapeHtml(`${base}/ar`)}</loc></url>`,
      `<url><loc>${escapeHtml(`${base}/ar/courses`)}</loc></url>`,
      ...rows.map((course) => `<url><loc>${escapeHtml(`${base}/ar/courses/${encodeURIComponent(course.slug)}`)}</loc>${day(course.publishedAt) ? `<lastmod>${day(course.publishedAt)}</lastmod>` : ''}</url>`),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
  },

  robots(environment: AppEnvironment) {
    return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${environment.APP_BASE_URL.replace(/\/+$/, '')}/sitemap.xml\n`;
  },
};
