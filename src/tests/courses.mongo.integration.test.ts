import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { Course } from '../models/Course';
import type { Snapshot } from '../shared/schemas/course';
import { Media } from '../models/Media';
import { AuditLog } from '../models/AuditLog';
import { User } from '../models/User';
import { coursesService } from '../services/coursesService';
import { cookieNames, createAccessToken } from '../services/authTokens';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
if (!uri) throw new Error('BE-4 course integration tests require MONGODB_URI_TEST.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-4 course integration tests require NODE_ENV=test.');
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
const environment = parseEnvironment({ NODE_ENV: 'test', PORT: '4000', MONGODB_URI: uri, ACCESS_TOKEN_SECRET: 'be4-course-test-access-secret-long-enough-00001', REFRESH_TOKEN_SECRET: 'be4-course-test-refresh-secret-long-enough-00002', COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent' });
const logger = createLogger('silent');
const app = createApp(environment, { logger });
const author = new mongoose.Types.ObjectId();
const actor = { id: String(author), name: { ar: 'مسؤول' }, email: 'admin@example.test', role: 'admin' as const, permissions: [] as never[] };
const collections = [Course.collection.name, Media.collection.name, AuditLog.collection.name, User.collection.name];

async function sessionFor(role: 'admin' | 'assistant') {
  const user = await User.create({ email: `be4c-${role}@example.test`, name: role === 'admin' ? 'مسؤول' : 'مساعد', passwordHash: 'test-hash-that-is-long-enough-12345', role });
  const names = cookieNames(environment);
  const accessCookie = `${names.access}=${createAccessToken(user, environment)}`;
  const csrf = await request(app).get('/api/v1/auth/csrf');
  return { accessCookie, csrfCookie: csrf.headers['set-cookie']?.[0]?.split(';')[0], csrfToken: csrf.body.csrfToken };
}

function snapshot(title = 'كورس تجريبي'): Snapshot {
  return {
    details: {
      title: { ar: title }, slug: 'course-example', shortDescription: { ar: 'وصف مختصر للكورس' }, category: 'التصميم',
      instructor: { name: { ar: 'مدرب تجريبي' } }, coverImage: { src: '/images/course-cover-default.webp', alt: { ar: '' }, decorative: true },
      delivery: { method: 'online' }, schedule: {}, pricing: { price: 15000, currency: 'EGP' }, enrollment: { registrationOpen: true }, accreditation: { verifiedByAcademy: false },
    },
    page: { schemaVersion: 1 as const, sections: [{ id: 'a1111111-1111-4111-8111-111111111111', type: 'hero' as const, visible: true, content: { title: { ar: 'ابدأ التعلم' } } }] },
    form: { fields: [] }, seo: {},
  } as unknown as Snapshot;
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
}, 60_000);
beforeEach(async () => { await clearNamedCollections(mongoose.connection, collections); });
afterAll(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await clearNamedCollections(mongoose.connection, collections);
  await mongoose.disconnect();
});

describe('BE-4 courses API and service', () => {
  it('creates, reads and lists courses with Admin service operations', async () => {
    const created = await coursesService.create({ slug: 'course-example', draft: snapshot() }, actor);
    expect(created).toMatchObject({ status: 'draft', version: 0, slug: 'course-example' });
    expect((await coursesService.get(created.id)).draft.details.title).toEqual({ ar: 'كورس تجريبي', en: '' });
    expect((await coursesService.list({ page: 1, pageSize: 20, sort: 'newest' })).items.map((item) => item.id)).toContain(created.id);
  });
  it('returns Admin list filters, featured and computed unpublished-change flags', async () => {
    const created = await coursesService.create({ slug: 'course-list-flags', draft: snapshot('React Basics') }, actor);
    await coursesService.publish(created.id, created.version, actor);
    const featured = await coursesService.setFeatured(created.id, true, actor);
    const draft = snapshot('React Basics'); draft.details.shortDescription.ar = 'وصف معدل بعد النشر';
    const saved = await coursesService.saveDraft(created.id, featured.version, draft, actor);
    const second = await coursesService.create({ slug: 'course-list-advanced', draft: snapshot('React Advanced') }, actor);
    await coursesService.publish(second.id, second.version, actor);
    const listed = await coursesService.list({ q: 'react', status: 'published', category: 'التصميم', page: 1, pageSize: 1, sort: 'title' });
    expect(listed).toMatchObject({ total: 2, page: 1, pageSize: 1, pageCount: 2 });
    expect(listed.items[0]).toMatchObject({ id: created.id, featured: true, hasUnpublishedChanges: true, version: saved.version });
    const admin = await sessionFor('admin');
    const response = await request(app).get('/api/v1/courses?q=react&status=published&category=%D8%A7%D9%84%D8%AA%D8%B5%D9%85%D9%8A%D9%85&page=1&pageSize=1&sort=title').set('Cookie', admin.accessCookie);
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 1, pageCount: 2 });
    expect(response.body.items[0]).toMatchObject({ featured: true, hasUnpublishedChanges: true });
    const secondPage = await request(app).get('/api/v1/courses?q=react&status=published&category=%D8%A7%D9%84%D8%AA%D8%B5%D9%85%D9%8A%D9%85&page=2&pageSize=1&sort=title').set('Cookie', admin.accessCookie);
    expect(secondPage.body.items[0].slug).toBe('course-list-advanced');
    const noMatch = await coursesService.list({ q: 'not-this-course', status: 'draft', category: 'التصميم', page: 1, pageSize: 1, sort: 'oldest' });
    expect(noMatch.total).toBe(0);
  });
  it('restricts dashboard course routes to Admin and accepts the new-course dialog payload', async () => {
    const admin = await User.create({ email: 'be4-admin@example.test', name: 'مسؤول', passwordHash: 'test-hash-that-is-long-enough-12345', role: 'admin' });
    const assistant = await User.create({ email: 'be4-assistant@example.test', name: 'مساعد', passwordHash: 'test-hash-that-is-long-enough-12345', role: 'assistant' });
    const names = cookieNames(environment);
    const adminCookie = `${names.access}=${createAccessToken(admin, environment)}`;
    const assistantCookie = `${names.access}=${createAccessToken(assistant, environment)}`;
    expect((await request(app).get('/api/v1/courses').set('Cookie', assistantCookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/courses').set('Cookie', adminCookie)).status).toBe(200);
    const csrf = await request(app).get('/api/v1/auth/csrf');
    const csrfCookie = csrf.headers['set-cookie']?.[0]?.split(';')[0];
    const created = await request(app).post('/api/v1/courses').set('Origin', 'http://localhost:5173').set('Cookie', `${adminCookie}; ${csrfCookie}`).set('X-CSRF-Token', csrf.body.csrfToken).send({ slug: 'api-new-course', title: { ar: 'كورس جديد' }, category: 'التصميم', template: 'blank' });
    expect(created.status).toBe(201);
    expect(created.body.course.draft.page.sections.map((section: { type: string }) => section.type)).toEqual(['registrationForm']);
  });
  it('allows only Admin to toggle featured and records the change in the audit log', async () => {
    const created = await coursesService.create({ slug: 'course-featured-toggle', draft: snapshot() }, actor);
    const admin = await sessionFor('admin');
    const assistant = await sessionFor('assistant');
    const adminResult = await request(app).patch(`/api/v1/courses/${created.id}/featured`)
      .set('Origin', 'http://localhost:5173').set('Cookie', `${admin.accessCookie}; ${admin.csrfCookie}`)
      .set('X-CSRF-Token', admin.csrfToken).send({ featured: true });
    expect(adminResult.status).toBe(200);
    expect(adminResult.body.course).toMatchObject({ id: created.id, slug: 'course-featured-toggle', featured: true, status: 'draft', hasUnpublishedChanges: false });
    const audit = await AuditLog.find({ entityType: 'course', entityId: new mongoose.Types.ObjectId(created.id), action: 'course_featured_updated' }).lean();
    expect(audit).toHaveLength(1); expect(audit[0]?.note).toBe('featured: false -> true');
    const assistantResult = await request(app).patch(`/api/v1/courses/${created.id}/featured`)
      .set('Origin', 'http://localhost:5173').set('Cookie', `${assistant.accessCookie}; ${assistant.csrfCookie}`)
      .set('X-CSRF-Token', assistant.csrfToken).send({ featured: false });
    expect(assistantResult.status).toBe(403);
    expect((await coursesService.get(created.id)).featured).toBe(true);
  });
  it('saves with expectedVersion, records slug history and rejects stale writes', async () => {
    const created = await coursesService.create({ slug: 'course-versioned', draft: snapshot() }, actor);
    const changed = snapshot(); changed.details.slug = 'course-updated';
    const saved = await coursesService.saveDraft(created.id, 0, changed, actor);
    expect(saved.version).toBe(1); expect(saved.slug).toBe('course-updated'); expect(saved.slugHistory).toContain('course-versioned');
    await expect(coursesService.saveDraft(created.id, 0, changed, actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(await coursesService.checkSlug('course-versioned')).toEqual({ available: false });
  });
  it('tracks and releases public media usage transactionally across draft, publish and soft delete', async () => {
    const key = 'media/2026/11/abcdef0123456789abcdef0123456789-original.webp';
    const media = await Media.create({ key, bucket: 'public', mime: 'image/webp', size: 200, width: 20, height: 10, uploadedBy: author, variants: [{ name: 'original', key, width: 20, height: 10, mime: 'image/webp' }] });
    const draft = snapshot(); draft.details.coverImage.src = key;
    const created = await coursesService.create({ slug: 'course-media', draft }, actor);
    expect((await Media.findById(media._id))?.usages.map((usage) => usage.field)).toEqual(['draft.details.coverImage']);
    const published = await coursesService.publish(created.id, created.version, actor);
    expect((await Media.findById(media._id))?.usages.map((usage) => usage.field).sort()).toEqual(['draft.details.coverImage', 'published.details.coverImage']);
    await coursesService.remove(created.id, published.version, actor);
    expect((await Media.findById(media._id))?.usages).toHaveLength(0);
  });
  it('validates readiness before publishing, then publishes and returns only public content', async () => {
    const created = await coursesService.create({ slug: 'course-public', draft: snapshot() }, actor);
    const published = await coursesService.publish(created.id, created.version, actor);
    expect(published.status).toBe('published'); expect(published.published).toBeTruthy();
    const page = await coursesService.publicBySlug('course-public');
    expect(page).toHaveProperty('course.slug', 'course-public');
    expect(JSON.stringify(page)).not.toContain(created.id);
    expect(await coursesService.publicList({ page: 1, pageSize: 20 })).toMatchObject({ total: 1 });
    const response = await request(app).get('/api/v1/public/courses/course-public');
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toContain('max-age'); expect(response.headers.etag).toBeTruthy();
    expect(response.body.course).not.toHaveProperty('id');
    expect((await request(app).get('/api/v1/public/courses/course-public').set('If-None-Match', response.headers.etag!)).status).toBe(304);
  });
  it('publishes one selected USD price in the public course response', async () => {
    const selected = snapshot('سعر بالدولار');
    selected.details.pricing = { price: 25_000, promo: 18_000, currency: 'USD' };
    const created = await coursesService.create({ slug: 'course-usd-price', draft: selected }, actor);
    const published = await coursesService.publish(created.id, created.version, actor);
    expect(published.status).toBe('published');
    const publicResponse = await request(app).get('/api/v1/public/courses/course-usd-price').expect(200);
    expect(publicResponse.body.course).toMatchObject({ price: 25_000, promoPrice: 18_000, currency: 'USD' });
    expect(publicResponse.body.course).not.toHaveProperty('foreignPricing');
  });
  it('blocks publishing when the selected currency has no price or contact option', async () => {
    const draft = snapshot('سعر ناقص');
    draft.details.pricing = { price: null, currency: 'USD' };
    const created = await coursesService.create({ slug: 'course-selected-price-missing', draft }, actor);
    await expect(coursesService.publish(created.id, created.version, actor)).rejects.toMatchObject({
      statusCode: 422,
      details: expect.arrayContaining([expect.objectContaining({ field: 'details.pricing.price' })]),
    });
  });
  it('uses the same public 404 for absent and unpublished courses, and resolves old slug to current slug', async () => {
    const created = await coursesService.create({ slug: 'course-old', draft: snapshot() }, actor);
    const unavailable = await request(app).get('/api/v1/public/courses/course-old');
    const unknown = await request(app).get('/api/v1/public/courses/absent-course');
    expect(unavailable.status).toBe(404); expect(unknown.status).toBe(404);
    expect(unavailable.body.error).toMatchObject({ code: 'NOT_FOUND', message: unknown.body.error.message });
    const draft = snapshot(); draft.details.slug = 'course-new';
    const saved = await coursesService.saveDraft(created.id, 0, draft, actor);
    await coursesService.publish(created.id, saved.version, actor);
    expect(await coursesService.publicBySlug('course-old')).toEqual({ redirect: true, slug: 'course-new' });
    expect((await request(app).get('/api/v1/public/courses/course-old')).body).toMatchObject({ status: 'redirect', slug: 'course-new' });
  });
  it('unpublishes, archives, restores and soft-deletes without deleting the record', async () => {
    const created = await coursesService.create({ slug: 'course-lifecycle', draft: snapshot() }, actor);
    const published = await coursesService.publish(created.id, created.version, actor);
    const hidden = await coursesService.changeStatus(created.id, published.version, 'draft', actor, 'course_unpublished');
    expect(hidden.status).toBe('draft'); expect(await coursesService.publicBySlug('course-lifecycle')).toBeNull();
    const archived = await coursesService.changeStatus(created.id, hidden.version, 'archived', actor, 'course_archived');
    await expect(coursesService.publish(created.id, archived.version, actor)).rejects.toMatchObject({ statusCode: 422 });
    const restored = await coursesService.changeStatus(created.id, archived.version, 'draft', actor, 'course_unarchived');
    expect(restored.status).toBe('draft');
    expect(await coursesService.remove(created.id, restored.version, actor)).toEqual({ deleted: true, id: created.id });
    expect(await Course.findById(created.id)).toBeNull();
    expect(await Course.findOne({ _id: created.id, deletedAt: { $ne: null } })).not.toBeNull();
    expect(await coursesService.checkSlug('course-lifecycle')).toEqual({ available: false });
  });
  it('does not publish an incomplete snapshot and sanitizes stored copy', async () => {
    const draft = snapshot(); draft.details.title.ar = '<script>alert(1)</script>';
    const created = await coursesService.create({ slug: 'course-safe', draft }, actor);
    expect((await coursesService.get(created.id)).draft.details.title.ar).not.toContain('<script>');
    const incomplete = snapshot(); incomplete.details.title.ar = '';
    const saved = await coursesService.saveDraft(created.id, created.version, incomplete, actor);
    await expect(coursesService.publish(created.id, saved.version, actor)).rejects.toMatchObject({ statusCode: 422 });
  });
  it('searches public title and description safely, filters category, paginates, and excludes unpublished courses', async () => {
    const alpha = snapshot('React Essentials'); alpha.details.shortDescription.ar = 'أساسيات البرمجة الحديثة'; alpha.details.category = 'البرمجة';
    const first = await coursesService.create({ slug: 'public-react-essentials', draft: alpha }, actor);
    const firstPublished = await coursesService.publish(first.id, first.version, actor);
    const secondDraft = snapshot('مهارات التصميم'); secondDraft.details.shortDescription.ar = 'دليل البحث العربي';
    secondDraft.details.category = 'التصميم';
    const second = await coursesService.create({ slug: 'public-design-skills', draft: secondDraft }, actor);
    await coursesService.publish(second.id, second.version, actor);
    const hiddenDraft = snapshot('React unpublished'); hiddenDraft.details.category = 'البرمجة';
    await coursesService.create({ slug: 'public-react-draft', draft: hiddenDraft }, actor);

    const caseInsensitive = await request(app).get('/api/v1/public/courses?q=react');
    expect(caseInsensitive.status).toBe(200); expect(caseInsensitive.body.total).toBe(1); expect(caseInsensitive.body.items[0].slug).toBe('public-react-essentials');
    const descriptionSearch = await request(app).get('/api/v1/public/courses?q=البحث+العربي&category=التصميم&page=1&pageSize=1');
    expect(descriptionSearch.body).toMatchObject({ total: 1, page: 1, pageSize: 1, pageCount: 1 });
    expect(descriptionSearch.body.items[0].slug).toBe('public-design-skills');
    const emptyCategory = await request(app).get('/api/v1/public/courses?category=التصميم&page=2&pageSize=1');
    expect(emptyCategory.body).toMatchObject({ total: 1, page: 2, pageCount: 1, items: [] });
    const injection = await request(app).get('/api/v1/public/courses?q=.*');
    expect(injection.status).toBe(200); expect(injection.body.total).toBe(0);
    expect((await request(app).get('/api/v1/public/courses?q=unpublished')).body.total).toBe(0);
    expect(firstPublished.status).toBe('published');
    expect((await request(app).get('/api/v1/public/courses?pageSize=51')).status).toBe(400);
  });
  it('orders featured courses before newer non-featured courses and then by publishedAt', async () => {
    const featuredOlder = await coursesService.create({ slug: 'featured-older', draft: snapshot('مميز أقدم') }, actor);
    const featuredOlderPublished = await coursesService.publish(featuredOlder.id, featuredOlder.version, actor);
    await coursesService.setFeatured(featuredOlder.id, true, actor);
    const featuredNewer = await coursesService.create({ slug: 'featured-newer', draft: snapshot('مميز أحدث') }, actor);
    await coursesService.publish(featuredNewer.id, featuredNewer.version, actor);
    await coursesService.setFeatured(featuredNewer.id, true, actor);
    const regular = await coursesService.create({ slug: 'regular-newer', draft: snapshot('عادي أحدث') }, actor);
    const regularPublished = await coursesService.publish(regular.id, regular.version, actor);
    await Course.collection.updateOne({ _id: new mongoose.Types.ObjectId(featuredOlder.id) }, { $set: { publishedAt: new Date('2026-01-01T00:00:00Z') } });
    await Course.collection.updateOne({ _id: new mongoose.Types.ObjectId(featuredNewer.id) }, { $set: { publishedAt: new Date('2026-03-01T00:00:00Z') } });
    await Course.collection.updateOne({ _id: new mongoose.Types.ObjectId(regular.id) }, { $set: { publishedAt: new Date('2026-02-01T00:00:00Z') } });
    const response = await request(app).get('/api/v1/public/courses?page=1&pageSize=12');
    expect(response.body.items.slice(0, 3).map((item: { slug: string }) => item.slug)).toEqual(['featured-newer', 'featured-older', 'regular-newer']);
    expect((await coursesService.get(featuredOlder.id)).version).toBe(featuredOlderPublished.version + 1);
    expect(regularPublished.status).toBe('published');
  });
  it('duplicates the current draft deeply, resets publication and verification state, and records only ids', async () => {
    const sourceDraft = snapshot('الكورس الأصلي');
    sourceDraft.details.slug = 'source-draft-slug';
    sourceDraft.details.accreditation.verifiedByAcademy = true;
    sourceDraft.page.sections.push({ id: 'b2222222-2222-4222-8222-222222222222', type: 'text', visible: true, content: { title: { ar: 'عنوان القسم' }, body: { ar: [] } } } as never);
    sourceDraft.form.fields = [{ id: 'field-stable', type: 'text', label: { ar: 'الاسم' }, required: true, options: [] } as never];
    sourceDraft.seo = { title: { ar: 'عنوان محركات البحث', en: '' }, description: { ar: 'وصف محركات البحث', en: '' }, noindex: true };
    sourceDraft.details.pricing = { price: 25_000, promo: 20_000, currency: 'USD' };
    const source = await coursesService.create({ slug: 'duplicate-source', draft: sourceDraft }, actor);
    const editedDraft = snapshot('النسخة الحالية للمسودة'); editedDraft.details.slug = 'duplicate-source';
    editedDraft.details.shortDescription.ar = 'تعديلات غير منشورة'; editedDraft.details.accreditation.verifiedByAcademy = true;
    const published = await coursesService.publish(source.id, source.version, actor);
    const current = await coursesService.saveDraft(source.id, published.version, editedDraft, actor);

    const duplicate = await coursesService.duplicate(source.id, { title: { ar: 'نسخة من النسخة الحالية للمسودة' }, slug: 'copy-current-draft' }, actor);
    expect(duplicate).toMatchObject({ slug: 'copy-current-draft', slugHistory: [], status: 'draft', featured: false, version: 1, createdBy: actor.id, published: null, draft: { details: { title: { ar: 'نسخة من النسخة الحالية للمسودة' }, slug: 'copy-current-draft', shortDescription: { ar: 'تعديلات غير منشورة' }, accreditation: { verifiedByAcademy: false } } } });
    expect(duplicate.publishedAt).toBeUndefined();
    expect(duplicate.draft).not.toBe(current.draft);
    expect(duplicate.draft.page.sections[0]?.id).not.toBe(current.draft.page.sections[0]?.id);
    const after = structuredClone(duplicate.draft); after.details.shortDescription.ar = 'تعديل النسخة فقط';
    await coursesService.saveDraft(duplicate.id, duplicate.version, after, actor);
    expect((await coursesService.get(source.id)).draft.details.shortDescription.ar).toBe('تعديلات غير منشورة');
    const duplicateAudit = await AuditLog.findOne({ action: 'course_duplicated', entityId: new mongoose.Types.ObjectId(duplicate.id) }).lean();
    expect(duplicateAudit?.note).toBe(source.id);
    expect(JSON.stringify(duplicateAudit)).not.toContain('تعديلات غير منشورة');
    expect((await Course.findById(duplicate.id).lean())?.allSlugs).toEqual(['copy-current-draft']);
  });
  it('preserves the copied registration field and option ids and selected USD pricing', async () => {
    const sourceDraft = snapshot('نسخة بسعر واحد');
    sourceDraft.form.fields = [{ id: 'stable-field', type: 'select', label: { ar: 'المسار' }, required: true, options: [{ id: 'stable-option', label: { ar: 'الأول' }, value: 'first' }, { id: 'stable-option-2', label: { ar: 'الثاني' }, value: 'second' }] } as never];
    sourceDraft.seo = { title: { ar: 'عنوان SEO', en: '' }, description: { ar: 'وصف SEO', en: '' }, noindex: true };
    sourceDraft.details.pricing = { price: 12_500, promo: 10_000, currency: 'USD' };
    const source = await coursesService.create({ slug: 'duplicate-preserve', draft: sourceDraft }, actor);
    const copy = await coursesService.duplicate(source.id, { title: { ar: 'نسخة من سعرين' }, slug: 'duplicate-preserve-copy' }, actor);
    expect(copy.draft.form.fields[0]).toMatchObject({ id: 'stable-field', options: [{ id: 'stable-option' }, { id: 'stable-option-2' }] });
    expect(copy.draft.seo).toEqual((await coursesService.get(source.id)).draft.seo);
    expect(copy.draft.details.pricing).toEqual((await coursesService.get(source.id)).draft.details.pricing);
  });
  it('rejects duplicate slugs reserved as current, historical, or soft-deleted', async () => {
    const source = await coursesService.create({ slug: 'duplicate-slug-source', draft: snapshot() }, actor);
    await coursesService.create({ slug: 'duplicate-taken-current', draft: snapshot() }, actor);
    const historical = await coursesService.create({ slug: 'duplicate-taken-history', draft: snapshot() }, actor);
    const changed = snapshot(); changed.details.slug = 'duplicate-history-current';
    await coursesService.saveDraft(historical.id, historical.version, changed, actor);
    const deleted = await coursesService.create({ slug: 'duplicate-taken-deleted', draft: snapshot() }, actor);
    await coursesService.remove(deleted.id, deleted.version, actor);
    for (const slug of ['duplicate-taken-current', 'duplicate-taken-history', 'duplicate-taken-deleted']) {
      await expect(coursesService.duplicate(source.id, { title: { ar: 'نسخة' }, slug }, actor)).rejects.toMatchObject({ statusCode: 409 });
    }
  });
  it('returns the same not-found response when the duplicate source has been soft-deleted', async () => {
    const source = await coursesService.create({ slug: 'duplicate-deleted-source', draft: snapshot() }, actor);
    await coursesService.remove(source.id, source.version, actor);
    const beforeCount = await Course.countDocuments();
    await expect(coursesService.duplicate(source.id, { title: { ar: 'نسخة من المحذوف' }, slug: 'duplicate-of-deleted' }, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(await Course.countDocuments()).toBe(beforeCount);
  });
  it('adds separate media usage references for cover, section and SEO images and rolls back when a key is gone', async () => {
    const keys = ['media/2026/11/abcdef0123456789abcdef0123456789.webp', 'media/2026/11/bcdef0123456789abcdef0123456789a.webp', 'media/2026/11/cdef0123456789abcdef0123456789ab.webp'];
    for (const key of keys) await Media.create({ key, bucket: 'public', mime: 'image/webp', size: 200, width: 20, height: 10, uploadedBy: author, variants: [{ name: 'original', key, width: 20, height: 10, mime: 'image/webp' }] });
    const draft = snapshot('كورس الصور'); draft.details.coverImage.src = keys[0]!;
    draft.page.sections = [{ id: 'c3333333-3333-4333-8333-333333333333', type: 'imageText', visible: true, content: { image: { src: keys[1]!, alt: { ar: '' }, decorative: true }, title: { ar: 'صورة القسم' }, richText: { ar: [] }, checklist: [], layout: 'imageStart', imageRatio: 'landscape' } } as never];
    draft.seo = { ogImage: { src: keys[2]!, alt: { ar: '', en: '' }, decorative: true } };
    const source = await coursesService.create({ slug: 'duplicate-media-source', draft }, actor);
    const copies = await Promise.all(keys.map((key) => Media.findOne({ key }).lean()));
    const copy = await coursesService.duplicate(source.id, { title: { ar: 'نسخة من الصور' }, slug: 'duplicate-media-copy' }, actor);
    for (const media of copies) {
      const updated = await Media.findById(media!._id).lean();
      expect(updated?.usages.filter((usage) => String(usage.entityId) === source.id)).toHaveLength(1);
      expect(updated?.usages.filter((usage) => String(usage.entityId) === copy.id)).toHaveLength(1);
    }
    const missing = snapshot(); missing.details.coverImage.src = 'media/2026/11/def0123456789abcdef0123456789abc.webp';
    await Course.collection.updateOne({ _id: new mongoose.Types.ObjectId(source.id) }, { $set: { draft: missing } });
    const beforeCount = await Course.countDocuments(); const auditBefore = await AuditLog.countDocuments({ action: 'course_duplicated' });
    await expect(coursesService.duplicate(source.id, { title: { ar: 'نسخة ناقصة' }, slug: 'duplicate-missing-media' }, actor)).rejects.toMatchObject({ statusCode: 422, details: expect.arrayContaining([expect.objectContaining({ code: 'media_not_found' })]) });
    expect(await Course.countDocuments()).toBe(beforeCount);
    expect(await AuditLog.countDocuments({ action: 'course_duplicated' })).toBe(auditBefore);
  });
  it('requires Admin, CSRF, valid inputs and an existing source for the duplicate route', async () => {
    const source = await coursesService.create({ slug: 'duplicate-route-source', draft: snapshot() }, actor);
    expect((await request(app).post(`/api/v1/courses/${source.id}/duplicate`).send({ title: { ar: 'نسخة' }, slug: 'duplicate-no-auth' })).status).toBe(401);
    const assistant = await sessionFor('assistant');
    const forbidden = await request(app).post(`/api/v1/courses/${source.id}/duplicate`).set('Origin', 'http://localhost:5173').set('Cookie', `${assistant.accessCookie}; ${assistant.csrfCookie}`).set('X-CSRF-Token', assistant.csrfToken).send({ title: { ar: 'نسخة' }, slug: 'duplicate-assistant' });
    expect(forbidden.status).toBe(403);
    const admin = await sessionFor('admin');
    const noCsrf = await request(app).post(`/api/v1/courses/${source.id}/duplicate`).set('Origin', 'http://localhost:5173').set('Cookie', admin.accessCookie).send({ title: { ar: 'نسخة' }, slug: 'duplicate-no-csrf' });
    expect(noCsrf.status).toBe(403);
    const missingSource = await request(app).post('/api/v1/courses/aaaaaaaaaaaaaaaaaaaaaaaa/duplicate').set('Origin', 'http://localhost:5173').set('Cookie', `${admin.accessCookie}; ${admin.csrfCookie}`).set('X-CSRF-Token', admin.csrfToken).send({ title: { ar: 'نسخة' }, slug: 'duplicate-unknown' });
    expect(missingSource.status).toBe(404);
    const invalidSlug = await request(app).post(`/api/v1/courses/${source.id}/duplicate`).set('Origin', 'http://localhost:5173').set('Cookie', `${admin.accessCookie}; ${admin.csrfCookie}`).set('X-CSRF-Token', admin.csrfToken).send({ title: { ar: 'نسخة' }, slug: 'not valid' });
    expect([400, 422]).toContain(invalidSlug.status);
    const valid = await request(app).post(`/api/v1/courses/${source.id}/duplicate`).set('Origin', 'http://localhost:5173').set('Cookie', `${admin.accessCookie}; ${admin.csrfCookie}`).set('X-CSRF-Token', admin.csrfToken).send({ title: { ar: 'نسخة من الكورس' }, slug: 'duplicate-route-copy' });
    expect(valid.status).toBe(201); expect(valid.body.course).toMatchObject({ slug: 'duplicate-route-copy', status: 'draft', featured: false, version: 1, published: null });
  });
});
