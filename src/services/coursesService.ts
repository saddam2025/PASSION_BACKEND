import { createHash, randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import mongoose from 'mongoose';
import { Course } from '../models/Course';
import { Media } from '../models/Media';
import { AuditLog } from '../models/AuditLog';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { withTransaction } from '../lib/withTransaction';
import { SnapshotSchema, type Snapshot } from '../shared/schemas/course';
import { checkReadiness } from '../shared/schemas/courseReadiness';
import { SECTION_REGISTRY_META } from '../shared/schemas/sections/index.js';
import { reservedSlugs } from '../shared/schemas/courseDraft';
import type { AuthActor } from '../types/express';

type CourseProjection = {
  _id: unknown; slug: string; slugHistory: string[]; status: 'draft' | 'published' | 'archived'; featured: boolean;
  createdBy: unknown; createdAt: Date; updatedAt: Date; publishedAt?: Date; deletedAt?: Date | null;
  version?: number; draft: Snapshot; published: Snapshot | null;
};
type PublicCourseProjection = Pick<CourseProjection, 'slug' | 'status' | 'featured' | 'published' | 'publishedAt'> & { _id: unknown; slugHistory?: string[] };
type PublishedCourseProjection = Omit<PublicCourseProjection, 'published'> & { published: Snapshot };

function clean(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
  if (Array.isArray(value)) return value.map(clean);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}
function snapshot(value: unknown): Snapshot {
  const plain = value && typeof value === 'object' && 'toObject' in value && typeof value.toObject === 'function' ? value.toObject({ depopulate: true, flattenMaps: true, versionKey: false }) : value;
  if (Buffer.byteLength(JSON.stringify(plain ?? null), 'utf8') > 1_800_000) throw new ValidationError('حجم محتوى الكورس أكبر من الحد المسموح.');
  const parsed = SnapshotSchema.safeParse(clean(plain));
  if (!parsed.success) throw new ValidationError('راجع بيانات الكورس وحاول تاني.', parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code })));
  return parsed.data;
}
function mediaRefs(value: unknown, prefix = '', seen = new WeakSet<object>()): Array<{ key: string; field: string }> {
  if (!value || typeof value !== 'object') return [];
  const plain = 'toObject' in value && typeof value.toObject === 'function' ? value.toObject({ depopulate: true, flattenMaps: true, versionKey: false }) : value;
  if (Array.isArray(plain)) return plain.flatMap((item, index) => mediaRefs(item, `${prefix}.${index}`, seen));
  if (plain instanceof Date || Buffer.isBuffer(plain) || (Object.getPrototypeOf(plain) !== Object.prototype && Object.getPrototypeOf(plain) !== null)) return [];
  if (seen.has(plain)) return [];
  seen.add(plain);
  const item = plain as Record<string, unknown>;
  const refs = typeof item.src === 'string' && item.src.startsWith('media/') ? [{ key: item.src, field: prefix || 'snapshot' }] : [];
  return [...refs, ...Object.entries(item).filter(([key]) => key !== 'src').flatMap(([key, nested]) => mediaRefs(nested, prefix ? `${prefix}.${key}` : key, seen))];
}
function project(course: CourseProjection) {
  return { id: String(course._id), slug: course.slug, slugHistory: course.slugHistory, status: course.status, featured: course.featured, createdBy: String(course.createdBy), createdAt: course.createdAt, updatedAt: course.updatedAt, publishedAt: course.publishedAt, deletedAt: course.deletedAt ?? undefined, version: course.version ?? 0, draft: course.draft, published: course.published ?? null };
}
function canonicalSnapshot(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalSnapshot).join(',')}]`;
  if (value && typeof value === 'object') {
    const plain = 'toObject' in value && typeof value.toObject === 'function' ? value.toObject({ depopulate: true, flattenMaps: true, versionKey: false }) : value;
    return `{${Object.entries(plain as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalSnapshot(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function hasUnpublishedChanges(course: CourseProjection): boolean {
  return course.status === 'published' && Boolean(course.published) && canonicalSnapshot(course.draft) !== canonicalSnapshot(course.published);
}
function listProjection(course: CourseProjection) { return { ...project(course), hasUnpublishedChanges: hasUnpublishedChanges(course) }; }
function courseSummary(course: CourseProjection) {
  return { id: String(course._id), slug: course.slug, status: course.status, featured: course.featured, hasUnpublishedChanges: hasUnpublishedChanges(course), title: course.draft.details.title, category: course.draft.details.category, coverImage: course.draft.details.coverImage, createdAt: course.createdAt, updatedAt: course.updatedAt, version: course.version ?? 0 };
}
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function publicValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => publicValue(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['_id', 'assetId', 'createdBy'].includes(key)).map(([key, item]) => [key, publicValue(item)])) as T;
}
async function addMediaUsage(id: mongoose.Types.ObjectId, value: unknown, session: mongoose.ClientSession) {
  const refs = mediaRefs(value);
  for (const ref of refs) {
    const media = await Media.findOne({ key: ref.key, bucket: 'public' }).session(session);
    if (!media) throw new ValidationError('في صورة مستخدمة في الكورس مش موجودة في مكتبة الوسائط.', [{ field: ref.field, code: 'media_not_found' }]);
    if (!media.usages.some((usage) => usage.entityType === 'course' && String(usage.entityId) === String(id) && usage.field === ref.field)) {
      media.usages.push({ entityType: 'course', entityId: id, field: ref.field });
      await media.save({ session });
    }
  }
}
async function replaceMediaUsage(id: mongoose.Types.ObjectId, oldValue: unknown, nextValue: unknown, session: mongoose.ClientSession) {
  await Media.updateMany({ 'usages.entityType': 'course', 'usages.entityId': id }, { $pull: { usages: { entityType: 'course', entityId: id } } }, { session });
  await addMediaUsage(id, nextValue, session);
  void oldValue;
}
async function audit(actor: AuthActor, action: string, id: mongoose.Types.ObjectId, beforeStatus?: string, afterStatus?: string, session?: mongoose.ClientSession, note?: string) {
  await AuditLog.create([{ actorId: new mongoose.Types.ObjectId(actor.id), action, entityType: 'course', entityId: id, ...(beforeStatus ? { beforeStatus } : {}), ...(afterStatus ? { afterStatus } : {}), ...(note ? { note } : {}), occurredAt: new Date() }], session ? { session } : undefined);
}
function getCourseOr404<T>(course: T | null): T { if (!course) throw new NotFoundError('الكورس ده مش موجود.'); return course; }
function versionConflict() { throw new ConflictError('الكورس اتعدل من مستخدم تاني. حدّث الصفحة وحاول تاني.'); }

const templateTypes = {
  full: ['hero', 'imageText', 'featureCards', 'curriculum', 'instructor', 'pricingCta', 'steps', 'faq', 'registrationForm', 'contactWhatsApp'],
  short: ['hero', 'text', 'pricingCta', 'registrationForm', 'contactWhatsApp'],
  blank: ['registrationForm'],
} as const;
export function createCourseTemplateSnapshot(input: { title: { ar: string; en?: string }; category: string; template: keyof typeof templateTypes }): Snapshot {
  const sections = templateTypes[input.template].map((type) => ({ id: randomUUID(), type, visible: true, content: SECTION_REGISTRY_META[type].defaultContent() }));
  return snapshot({
    details: {
      title: input.title, shortDescription: { ar: '', en: '' }, category: input.category,
      instructor: { name: { ar: '', en: '' }, title: { ar: '', en: '' } },
      coverImage: { src: '/images/course-cover-default.webp', alt: input.title, decorative: true },
      delivery: { method: 'online' }, schedule: {}, pricing: { price: null, currency: 'EGP', contactUs: false },
      enrollment: { registrationOpen: false }, accreditation: { verifiedByAcademy: false },
    },
    page: { schemaVersion: 1, sections }, form: { fields: [] }, seo: { title: input.title, description: { ar: '', en: '' } },
  });
}

export const coursesService = {
  async create(input: { slug: string; draft?: unknown; title?: { ar: string; en?: string }; category?: string; template?: 'full' | 'short' | 'blank'; featured?: boolean }, actor: AuthActor) {
    const cleanDraft = input.draft !== undefined ? snapshot(input.draft) : snapshot(createCourseTemplateSnapshot({ title: { ar: input.title?.ar ?? '', en: input.title?.en ?? '' }, category: input.category ?? '', template: input.template ?? 'full' }));
    const course = new Course({ slug: input.slug, slugHistory: [], status: 'draft', featured: input.featured ?? false, createdBy: new mongoose.Types.ObjectId(actor.id), draft: cleanDraft, published: null });
    try {
      await withTransaction(async (session) => { await course.save({ session }); await addMediaUsage(course._id, { draft: cleanDraft }, session); await audit(actor, 'course_created', course._id, undefined, 'draft', session); });
    } catch (error) { if ((error as { code?: number })?.code === 11000) throw new ConflictError('الرابط ده مستخدم قبل كده.'); throw error; }
    return project(course.toObject() as unknown as CourseProjection);
  },
  async list(query: { q?: string; status?: string; category?: string; page: number; pageSize: number; sort: string }) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter['draft.details.category'] = query.category;
    if (query.q) filter.$or = [{ slug: { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { 'draft.details.title.ar': { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    const sort = query.sort === 'oldest' ? { createdAt: 1 as const } : query.sort === 'title' ? { 'draft.details.title.ar': 1 as const } : { updatedAt: -1 as const };
    const [rows, total] = await Promise.all([Course.find(filter).sort(sort).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(), Course.countDocuments(filter)]);
    return { items: rows.map((row) => listProjection(row as unknown as CourseProjection)), total, page: query.page, pageSize: query.pageSize, pageCount: Math.ceil(total / query.pageSize) };
  },
  async get(id: string) { if (!mongoose.isValidObjectId(id)) throw new NotFoundError('الكورس ده مش موجود.'); return project(getCourseOr404(await Course.findById(id).lean()) as unknown as CourseProjection); },
  async saveDraft(id: string, expectedVersion: number, value: unknown, actor: AuthActor) {
    const cleanDraft = snapshot(value);
    return withTransaction(async (session) => {
      const course = getCourseOr404(await Course.findById(id).session(session));
      if (course.version !== expectedVersion) versionConflict();
      const before = course.status; const oldDraft = course.draft;
      const nextSlug = cleanDraft.details.slug || course.slug;
      if (reservedSlugs.has(nextSlug)) throw new ValidationError('الرابط المختصر محجوز.');
      if (nextSlug !== course.slug) { course.slugHistory = [...new Set([...course.slugHistory, course.slug])]; course.slug = nextSlug; }
      course.draft = cleanDraft as never; course.markSectionContentModified();
      await course.save({ session });
      await replaceMediaUsage(course._id, oldDraft, { draft: cleanDraft, published: course.published }, session);
      await audit(actor, 'course_draft_saved', course._id, before, course.status, session);
      return project(course.toObject() as unknown as CourseProjection);
    }).catch((error: unknown) => { if (error instanceof mongoose.Error.VersionError) versionConflict(); if ((error as { code?: number })?.code === 11000) throw new ConflictError('الرابط ده مستخدم قبل كده.'); throw error; });
  },
  async publish(id: string, expectedVersion: number, actor: AuthActor) {
    return withTransaction(async (session) => {
      const course = getCourseOr404(await Course.findById(id).session(session)); if (course.version !== expectedVersion) versionConflict();
      if (course.status === 'archived') throw new ValidationError('ما ينفعش تنشر كورس مؤرشف. ألغِ الأرشفة الأول.');
      const cleanDraft = snapshot(course.draft);
      const readiness = checkReadiness(cleanDraft, course.slug);
      if (readiness.errors.length) throw new ValidationError('الكورس محتاج بيانات قبل النشر.', readiness.errors.map(({ path, message, sectionId }) => ({ field: path, message, ...(sectionId ? { sectionId } : {}) })));
      const before = course.status; course.draft = cleanDraft as never; course.published = cleanDraft as never; course.status = 'published'; course.publishedAt = new Date(); course.markSectionContentModified(); await course.save({ session });
      await replaceMediaUsage(course._id, null, { draft: course.draft, published: course.published }, session); await audit(actor, 'course_published', course._id, before, 'published', session); return project(course.toObject() as unknown as CourseProjection);
    }).catch((error: unknown) => { if (error instanceof mongoose.Error.VersionError) versionConflict(); if ((error as { code?: number })?.code === 11000) throw new ConflictError('الرابط ده مستخدم قبل كده.'); throw error; });
  },
  async changeStatus(id: string, expectedVersion: number, status: 'draft' | 'archived', actor: AuthActor, action: string) {
    return withTransaction(async (session) => { const course = getCourseOr404(await Course.findById(id).session(session)); if (course.version !== expectedVersion) versionConflict(); const before = course.status; course.status = status; await course.save({ session }); await audit(actor, action, course._id, before, status, session); return project(course.toObject() as unknown as CourseProjection); }).catch((error: unknown) => { if (error instanceof mongoose.Error.VersionError) versionConflict(); throw error; });
  },
  async remove(id: string, expectedVersion: number, actor: AuthActor) {
    return withTransaction(async (session) => { const course = getCourseOr404(await Course.findById(id).session(session)); if (course.version !== expectedVersion) versionConflict(); const before = course.status; course.deletedAt = new Date(); course.status = 'archived'; await course.save({ session }); await Media.updateMany({ 'usages.entityType': 'course', 'usages.entityId': course._id }, { $pull: { usages: { entityType: 'course', entityId: course._id } } }, { session }); await audit(actor, 'course_deleted', course._id, before, 'archived', session); return { deleted: true, id }; }).catch((error: unknown) => { if (error instanceof mongoose.Error.VersionError) versionConflict(); throw error; });
  },
  async checkSlug(slug: string, excludeId?: string) {
    const filter: Record<string, unknown> = { allSlugs: slug };
    if (excludeId && mongoose.isValidObjectId(excludeId)) filter._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
    // Use the collection here to include soft-deleted courses: their slugs stay reserved.
    const existing = await Course.collection.findOne(filter, { projection: { _id: 1 } });
    return { available: !existing };
  },
  async setFeatured(id: string, featured: boolean, actor: AuthActor) {
    if (!mongoose.isValidObjectId(id)) throw new NotFoundError('الكورس ده مش موجود.');
    return withTransaction(async (session) => {
      const course = getCourseOr404(await Course.findById(id).session(session));
      if (course.featured !== featured) {
        course.featured = featured;
        await course.save({ session });
        await audit(actor, 'course_featured_updated', course._id, undefined, undefined, session, `featured: ${!featured} -> ${featured}`);
      }
      return courseSummary(course.toObject() as unknown as CourseProjection);
    }).catch((error: unknown) => { if (error instanceof mongoose.Error.VersionError) versionConflict(); throw error; });
  },
  async publicList(query: { q?: string; category?: string; featured?: string; page: number; pageSize: number }) {
    const filter: Record<string, unknown> = { status: 'published', published: { $ne: null } };
    if (query.category) filter['published.details.category'] = query.category;
    if (query.featured) filter.featured = query.featured === 'true';
    if (query.q?.trim()) {
      const q = escapeRegex(query.q.trim());
      filter.$or = [{ 'published.details.title.ar': { $regex: q, $options: 'i' } }, { 'published.details.shortDescription.ar': { $regex: q, $options: 'i' } }];
    }
    const [rows, total] = await Promise.all([Course.find(filter).sort({ featured: -1, publishedAt: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).select('slug featured published publishedAt').lean(), Course.countDocuments(filter)]);
    const items = rows.map((row) => publicSummary(row as unknown as PublishedCourseProjection)); return { items, total, page: query.page, pageSize: query.pageSize, pageCount: Math.ceil(total / query.pageSize) };
  },
  async publicBySlug(slug: string) {
    const course = await Course.findOne({ $or: [{ slug }, { slugHistory: slug }] }).select('slug slugHistory status published publishedAt featured').lean() as unknown as PublicCourseProjection | null;
    const published = course?.published;
    if (!course || course.status !== 'published' || !published) return null;
    if (course.slug !== slug) return { redirect: true as const, slug: course.slug };
    return { course: { ...publicSummary({ ...course, published }), registrationOpen: published.details.enrollment?.registrationOpen === true, pageConfig: publicValue(published.page), formDefinition: publicValue(published.form), whatsappNumber: published.details.whatsappOverrides?.number, whatsappUrl: published.details.whatsappOverrides?.url, whatsappMessageTemplate: publicValue(published.details.whatsappOverrides?.messageTemplate ?? { ar: '' }) } };
  },
};

function publicSummary(course: PublishedCourseProjection) {
  const details = course.published.details; const pricing = details.pricing ?? {}; const instructor = details.instructor ?? {}; const seo = course.published.seo ?? {};
  return publicValue({ slug: course.slug, title: details.title, shortDescription: details.shortDescription, seoTitle: seo.title ?? details.title, seoDescription: seo.description ?? details.shortDescription, noindex: seo.noindex, ogImage: seo.ogImage, category: { ar: String(details.category ?? '') }, instructorName: instructor.name ?? { ar: '' }, instructor, coverImage: details.coverImage, price: pricing.price, promoPrice: pricing.promoPrice ?? pricing.promo, currency: pricing.currency ?? 'EGP', startDate: details.schedule?.startDate ?? '', duration: details.schedule?.duration ?? { ar: '' }, deliveryMethod: details.delivery?.method === 'in_person' ? 'inPerson' : details.delivery?.method ?? '', publishedAt: course.publishedAt?.toISOString?.() ?? course.publishedAt, featured: Boolean(course.featured), accreditationVerified: details.accreditation?.verifiedByAcademy === true, delivery: details.delivery, schedule: details.schedule, accreditation: details.accreditation });
}

export function courseEtag(value: unknown) { return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`; }
