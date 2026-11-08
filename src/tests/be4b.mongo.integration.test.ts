import 'dotenv/config';
import mongoose from 'mongoose';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnvironment } from '../config/env';
import { createApp } from '../app/createApp';
import { AuditLog } from '../models/AuditLog';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Notification } from '../models/Notification';
import { Payment } from '../models/Payment';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { createAccessToken } from '../services/authTokens';
import { publicSettings, readSettings } from '../services/settingsApiService';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || (uri ? new URL(uri).pathname.replace(/^\//, '').split('/')[0] : 'passion_test')!);
if (!uri) throw new Error('BE-4B integration tests require MONGODB_URI_TEST; skipped tests are not accepted.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-4B integration tests require NODE_ENV=test.');
const owned = [AuditLog, Course, Enrollment, Lead, Notification, Payment, Settings, User].map((model) => model.collection.name);
const adminEmail = 'be4b-admin@example.test';
const assistantEmail = 'be4b-assistant@example.test';
const environment = { ...parseEnvironment({ NODE_ENV: 'test', PORT: '4000', MONGODB_URI: uri, ACCESS_TOKEN_SECRET: 'be4b-access-secret-long-enough-00000001', REFRESH_TOKEN_SECRET: 'be4b-refresh-secret-long-enough-00000002', COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'https://academy.example', LOG_LEVEL: 'silent' }), R2_PUBLIC_BASE_URL: 'https://cdn.example' };
const app = createApp(environment, { logger: pino({ level: 'silent' }) });
let adminId: mongoose.Types.ObjectId;
let assistantId: mongoose.Types.ObjectId;
let adminCookie: string;
let assistantCookie: string;
const csrf = 'be4b-csrf-token';
const origin = environment.CORS_ORIGINS[0]!;

function write(cookie: string, method: 'post' | 'put' | 'patch' | 'delete', path: string) {
  return request(app)[method](path).set('Cookie', `${cookie}; passion_csrf=${csrf}`).set('Origin', origin).set('X-CSRF-Token', csrf);
}
async function createCourse(slug: string, options: { status?: 'draft' | 'published' | 'archived'; noindex?: boolean; title?: string; oldSlug?: string; image?: string } = {}) {
  const id = new mongoose.Types.ObjectId();
  const title = options.title ?? 'كورس تجريبي';
  return Course.create({ _id: id, slug, slugHistory: options.oldSlug ? [options.oldSlug] : [], status: options.status ?? 'published', featured: false, createdBy: adminId, publishedAt: new Date('2026-10-01T10:00:00Z'), draft: { details: { title: { ar: title }, shortDescription: { ar: 'وصف تجريبي' }, coverImage: { src: options.image ?? 'media/cover.webp' } }, page: { schemaVersion: 1, sections: [] }, form: { fields: [] }, seo: {} }, published: options.status === 'draft' ? null : { details: { title: { ar: title }, shortDescription: { ar: 'وصف تجريبي' }, coverImage: { src: options.image ?? 'media/cover.webp' } }, page: { schemaVersion: 1, sections: [] }, form: { fields: [] }, seo: { title: { ar: title }, description: { ar: 'وصف تجريبي' }, ogImage: options.image ? { src: options.image } : undefined, noindex: options.noindex } } });
}
async function createEnrollment(course: Awaited<ReturnType<typeof createCourse>>, input: { reference: string; registeredAt: string; status?: 'pending' | 'confirmed' | 'cancelled'; paymentStatus?: string; currency?: 'EGP' | 'USD'; amount?: number }) {
  const lead = await Lead.create({ fullName: 'عميل اختباري', email: `${input.reference.toLowerCase()}@example.test`, phone: '01012345678', phoneNormalized: '201012345678', consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {} });
  return Enrollment.create({ reference: input.reference, leadId: lead._id, courseId: course._id, courseSnapshot: { title: { ar: course.published?.details?.title?.ar ?? 'كورس تجريبي' }, slug: course.slug }, priceSnapshot: { amount: input.amount ?? 1_000, currency: input.currency ?? 'EGP' }, audience: input.currency === 'USD' ? 'foreign' : 'egyptian', consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: {}, enrollmentStatus: input.status ?? 'pending', followUpStatus: 'new', isActive: input.status !== 'cancelled', registeredAt: new Date(input.registeredAt), idempotencyKey: `be4b-enrollment-${input.reference}`, paymentSummary: { netMinor: 0, currency: input.currency ?? 'EGP', status: input.paymentStatus ?? 'unpaid', lastPaymentAt: null } });
}
async function createPayment(enrollmentId: mongoose.Types.ObjectId, recorderId: mongoose.Types.ObjectId, key: string, overrides: Partial<{ kind: 'payment' | 'refund'; status: 'confirmed' | 'voided'; receivedAt: Date; amount: number; currency: 'EGP' | 'USD' }> = {}) {
  const record = await Payment.create({ enrollmentId, kind: overrides.kind ?? 'payment', amount: overrides.amount ?? 1_000, currency: overrides.currency ?? 'EGP', method: 'cash', receivedAt: overrides.receivedAt ?? new Date(), status: 'confirmed', recordedBy: recorderId, confirmedBy: recorderId, idempotencyKey: key });
  if (overrides.status === 'voided') await Payment.collection.updateOne({ _id: record._id }, { $set: { status: 'voided', voidedAt: new Date(), voidedBy: recorderId, voidReason: 'سجل تجريبي' } });
  return record;
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, owned);
  adminId = new mongoose.Types.ObjectId(); assistantId = new mongoose.Types.ObjectId();
  await User.create([
    { _id: adminId, email: adminEmail, name: 'مسؤول الاختبار', role: 'admin', passwordHash: 'be4b-test-hash-admin-0000000001', isActive: true },
    { _id: assistantId, email: assistantEmail, name: 'مساعد الاختبار', role: 'assistant', permissions: { exportCsv: true, viewFinancialReports: true, viewSettings: true }, passwordHash: 'be4b-test-hash-assistant-00001', isActive: true },
  ]);
  const admin = await User.findById(adminId); const assistant = await User.findById(assistantId);
  adminCookie = `passion_access=${createAccessToken(admin!, environment)}`;
  assistantCookie = `passion_access=${createAccessToken(assistant!, environment)}`;
  await Settings.create({ key: 'academy', academyName: { ar: 'أكاديمية الاختبار' }, defaultCurrency: 'EGP' });
}, 60_000);
afterAll(async () => { if (mongoose.connection.readyState === 1) { await clearNamedCollections(mongoose.connection, owned); await mongoose.disconnect(); } });

describe('BE-4B overview aggregation and role policy', () => {
  it('aggregates Cairo registration cohorts and confirmed net EGP revenue with inclusive days, cancellations and voids', async () => {
    const course = await createCourse('overview-course');
    const beforeDay = await createEnrollment(course, { reference: 'PAS-AB2345', registeredAt: '2026-10-31T21:59:59.000Z' });
    const at0030 = await createEnrollment(course, { reference: 'PAS-CD2346', registeredAt: '2026-10-31T22:30:00.000Z', paymentStatus: 'paid' });
    const at2330 = await createEnrollment(course, { reference: 'PAS-EF2347', registeredAt: '2026-11-01T21:30:00.000Z', status: 'cancelled' });
    const pending = await createEnrollment(course, { reference: 'PAS-GH2349', registeredAt: '2026-11-01T10:00:00.000Z' });
    const afterDay = await createEnrollment(course, { reference: 'PAS-GH2348', registeredAt: '2026-11-01T22:30:00.000Z' });
    await createPayment(at0030._id, adminId, 'be4b-overview-in-range', { receivedAt: new Date('2026-11-01T21:30:00Z') });
    await createPayment(pending._id, adminId, 'be4b-overview-early-boundary', { receivedAt: new Date('2026-10-31T22:30:00Z'), amount: 300 });
    await createPayment(beforeDay._id, adminId, 'be4b-overview-before', { receivedAt: new Date('2026-10-31T21:59:00Z') });
    await createPayment(at2330._id, adminId, 'be4b-overview-voided', { receivedAt: new Date('2026-11-01T21:30:00Z'), status: 'voided' });
    const result = await request(app).get('/api/v1/admin/overview?from=2026-11-01&to=2026-11-01').set('Cookie', adminCookie).expect(200);
    expect(result.body).toMatchObject({ registrations: 3, paid: 1, unpaid: 1, netRevenue: 1_300, courses: [{ title: 'كورس تجريبي', registrations: 3, paid: 1, revenue: 1_300, currency: 'EGP' }] });
    expect(result.body.revenueByCurrency).toEqual([{ currency: 'EGP', netRevenue: 1_300, paidCount: 1, unpaidCount: 1 }, { currency: 'USD', netRevenue: 0, paidCount: 0, unpaidCount: 0 }]);
    expect((await request(app).get('/api/v1/admin/overview').set('Cookie', assistantCookie)).status).toBe(403);
    await request(app).get('/api/v1/admin/overview').expect(401);
    const empty = await request(app).get('/api/v1/admin/overview?from=2026-11-03&to=2026-11-04').set('Cookie', adminCookie).expect(200);
    expect(empty.body).toMatchObject({ registrations: 0, paid: 0, unpaid: 0, netRevenue: 0, courses: [] });
    const enrollmentIndexes = await Enrollment.collection.indexes(); const paymentIndexes = await Payment.collection.indexes();
    expect(enrollmentIndexes.some((index) => index.key.registeredAt === 1 && index.key.courseId === 1)).toBe(true);
    expect(paymentIndexes.some((index) => index.key.status === 1 && index.key.currency === 1 && index.key.receivedAt === 1)).toBe(true);
    expect(paymentIndexes.some((index) => index.key.enrollmentId === 1 && index.key.status === 1 && index.key.kind === 1)).toBe(true);
    expect(paymentIndexes.some((index) => index.key.status === 1 && index.key.receivedAt === 1 && index.key.kind === 1 && index.key.currency === 1)).toBe(true);
    expect(afterDay).toBeTruthy();
  });

  it('reports mixed EGP and USD revenue separately without conversion or a combined total', async () => {
    const course = await createCourse('overview-mixed-currencies');
    const egp = await createEnrollment(course, { reference: 'PAS-AB2346', registeredAt: '2026-11-02T10:00:00Z', paymentStatus: 'paid', amount: 10_000 });
    const usd = await createEnrollment(course, { reference: 'PAS-CD2347', registeredAt: '2026-11-02T11:00:00Z', paymentStatus: 'paid', amount: 8_000, currency: 'USD' });
    const unpaidUsd = await createEnrollment(course, { reference: 'PAS-EF2348', registeredAt: '2026-11-02T12:00:00Z', currency: 'USD' });
    await createPayment(egp._id, adminId, 'be4b-mixed-egp-payment', { amount: 7_000, currency: 'EGP', receivedAt: new Date('2026-11-02T10:00:00Z') });
    await createPayment(usd._id, adminId, 'be4b-mixed-usd-payment', { amount: 5_000, currency: 'USD', receivedAt: new Date('2026-11-02T11:00:00Z') });
    const result = await request(app).get('/api/v1/admin/overview?from=2026-11-02&to=2026-11-02').set('Cookie', adminCookie).expect(200);
    expect(result.body).toMatchObject({ registrations: 3, netRevenue: 7_000, revenueByCurrency: [{ currency: 'EGP', netRevenue: 7_000, paidCount: 1, unpaidCount: 0 }, { currency: 'USD', netRevenue: 5_000, paidCount: 1, unpaidCount: 1 }], courses: [{ revenue: 7_000, currency: 'EGP', netByCurrency: { EGP: 7_000, USD: 5_000 } }] });
    expect(result.body).not.toHaveProperty('totalRevenueAllCurrencies');
    expect(unpaidUsd).toBeTruthy();
  });

  it('gives the Assistant fixed payment rights, own-payment void only, and keeps restricted actions Admin-only', async () => {
    const course = await createCourse('permissions-course');
    const mine = await createEnrollment(course, { reference: 'PAS-JK2345', registeredAt: new Date().toISOString() });
    const theirs = await createEnrollment(course, { reference: 'PAS-LM2346', registeredAt: new Date().toISOString() });
    const otherPayment = await createPayment(theirs._id, adminId, 'be4b-assistant-other-payment');
    const recorded = await write(assistantCookie, 'post', `/api/v1/enrollments/${mine._id}/payments`).send({ kind: 'payment', amount: 1_000, currency: 'EGP', method: 'cash', receivedAt: new Date().toISOString(), idempotencyKey: 'be4b-assistant-own-payment' }).expect(201);
    await write(assistantCookie, 'post', `/api/v1/payments/${recorded.body.payment.id}/void`).send({ reason: 'دفعة مسجلة بالخطأ' }).expect(200);
    await write(assistantCookie, 'post', `/api/v1/payments/${otherPayment._id}/void`).send({ reason: 'محاولة إلغاء دفعة غيري' }).expect(403);
    await write(assistantCookie, 'post', `/api/v1/enrollments/${mine._id}/payments`).send({ kind: 'refund', amount: 100, currency: 'EGP', method: 'cash', receivedAt: new Date().toISOString(), note: 'استرداد', idempotencyKey: 'be4b-assistant-refund' }).expect(403);
    await write(assistantCookie, 'post', `/api/v1/enrollments/${mine._id}/assign`).send({ assigneeId: String(assistantId) }).expect(403);
    await write(assistantCookie, 'post', `/api/v1/enrollments/${mine._id}/cancel`).send({ reason: 'إلغاء اختباري' }).expect(403);
    await write(assistantCookie, 'post', `/api/v1/enrollments/${mine._id}/confirm`).send({}).expect(403);
    await request(app).get('/api/v1/enrollments/export.csv').set('Cookie', assistantCookie).expect(403);
    await write(assistantCookie, 'post', `/api/v1/payments/${recorded.body.payment.id}/void`).send({ reason: 'محاولة تانية' }).expect(404);
  });
});

describe('BE-CHARTS overview ranges and chart aggregations', () => {
  it('uses typed validation for malformed, reversed, oversized and future ranges', async () => {
    const malformed = await request(app).get('/api/v1/admin/overview/charts?from=2026-02-30').set('Cookie', adminCookie).expect(422);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(malformed.body.error.details[0].path).toContain('from');
    const reversed = await request(app).get('/api/v1/admin/overview?from=2026-11-03&to=2026-11-02').set('Cookie', adminCookie).expect(422);
    expect(reversed.body.error.code).toBe('INVALID_RANGE');
    expect(reversed.body.error.details[0].path).toContain('to');
    const tooLarge = await request(app).get('/api/v1/admin/overview/charts?from=2025-01-01&to=2026-02-05').set('Cookie', adminCookie).expect(422);
    expect(tooLarge.body.error.code).toBe('RANGE_TOO_LARGE');
    const future = await request(app).get('/api/v1/admin/overview/charts?from=2099-01-01&to=2099-01-03').set('Cookie', adminCookie).expect(200);
    expect(future.body).toMatchObject({ registrations: 0, paid: 0, registrationsSeries: [], revenueSeriesByCurrency: [], byCourse: [] });
  });

  it('selects day/week/month granularity at 62/63 and 400/401 day boundaries', async () => {
    const query = async (from: string, to: string) => (await request(app).get(`/api/v1/admin/overview/charts?from=${from}&to=${to}`).set('Cookie', adminCookie).expect(200)).body.range.granularity;
    expect(await query('2020-01-01', '2020-03-02')).toBe('day');
    expect(await query('2020-01-01', '2020-03-03')).toBe('week');
    expect(await query('2020-01-01', '2021-02-03')).toBe('week');
    expect(await query('2020-01-01', '2021-02-04')).toBe('month');
  });

  it('zero-fills Cairo day buckets and aggregates cohort, payment, refund, void, funnel, currency and course data', async () => {
    const courseData = await Promise.all(Array.from({ length: 7 }, (_, index) => createCourse(`charts-course-${index}`, { title: `عنوان ${index}` })));
    const registrations = await Promise.all(courseData.map((course, index) => createEnrollment(course, {
      reference: `PAS-${['AB2345', 'CD2346', 'EF2347', 'GH2348', 'JK2349', 'LM2356', 'NP2357'][index]}`,
      registeredAt: index === 0 ? '2026-11-01T22:30:00.000Z' : index === 1 ? '2026-11-02T21:30:00.000Z' : '2026-11-02T10:00:00.000Z',
      ...(index === 6 ? { status: 'cancelled' as const } : {}),
      paymentStatus: index === 0 ? 'paid' : index === 1 ? 'partially_refunded' : index === 5 ? 'refunded' : 'unpaid',
      currency: index === 1 ? 'USD' : 'EGP',
      amount: 10_000,
    })));
    await createPayment(registrations[0]!._id, adminId, 'becharts-day-one-pay', { receivedAt: new Date('2026-11-01T22:30:00.000Z'), amount: 10_000 });
    await createPayment(registrations[1]!._id, adminId, 'becharts-day-two-pay', { receivedAt: new Date('2026-11-02T21:30:00.000Z'), amount: 8_000, currency: 'USD' });
    await Payment.create({ enrollmentId: registrations[1]!._id, kind: 'refund', amount: 2_000, currency: 'USD', method: 'cash', receivedAt: new Date('2026-11-03T10:00:00.000Z'), status: 'confirmed', recordedBy: adminId, confirmedBy: adminId, idempotencyKey: 'becharts-day-three-refund' });
    await createPayment(registrations[2]!._id, adminId, 'becharts-voided-payment', { receivedAt: new Date('2026-11-02T10:00:00.000Z'), status: 'voided' });
    await Payment.create({ enrollmentId: registrations[3]!._id, kind: 'refund', amount: 500, currency: 'EGP', method: 'cash', receivedAt: new Date('2026-11-03T10:00:00.000Z'), status: 'confirmed', recordedBy: adminId, confirmedBy: adminId, idempotencyKey: 'becharts-egp-refund' });
    await Enrollment.updateOne({ _id: registrations[4]!._id }, { $set: { followUpStatus: 'new' } });
    const result = await request(app).get('/api/v1/admin/overview/charts?from=2026-11-02&to=2026-11-04').set('Cookie', adminCookie).expect(200);
    expect(result.body.range).toEqual({ from: '2026-11-02', to: '2026-11-04', granularity: 'day' });
    expect(result.body.registrationsSeries).toEqual([
      { bucket: '2026-11-02', registrations: 2, paid: 1 },
      { bucket: '2026-11-03', registrations: 5, paid: 0 },
      { bucket: '2026-11-04', registrations: 0, paid: 0 },
    ]);
    expect(result.body.revenueSeriesByCurrency).toEqual([
      { currency: 'EGP', series: [{ bucket: '2026-11-02', netRevenue: 10_000 }, { bucket: '2026-11-03', netRevenue: -500 }, { bucket: '2026-11-04', netRevenue: 0 }] },
      { currency: 'USD', series: [{ bucket: '2026-11-02', netRevenue: 0 }, { bucket: '2026-11-03', netRevenue: 6_000 }, { bucket: '2026-11-04', netRevenue: 0 }] },
    ]);
    expect(result.body.funnel).toMatchObject({ registered: 6, contacted: 2, awaitingPayment: 1, paid: 1, cancelled: 1 });
    expect(result.body.funnel.registered).toBeGreaterThanOrEqual(result.body.funnel.contacted);
    expect(result.body.funnel.contacted).toBeGreaterThanOrEqual(result.body.funnel.awaitingPayment);
    expect(result.body.funnel.awaitingPayment).toBeGreaterThanOrEqual(result.body.funnel.paid);
    expect(result.body.paymentStatusDistribution).toEqual(expect.arrayContaining([{ status: 'paid', count: 1 }, { status: 'partially_refunded', count: 1 }, { status: 'refunded', count: 1 }, { status: 'cancelled', count: 1 }]));
    expect(result.body.byCourse).toHaveLength(6);
    expect(result.body.byCourse[5]).toMatchObject({ courseId: 'other', registrations: 2 });
    expect(result.body).not.toHaveProperty('byAudience');
    expect(result.body.revenueSeriesByCurrency).not.toHaveProperty('totalRevenue');

    const overview = await request(app).get('/api/v1/admin/overview?from=2026-11-02&to=2026-11-04').set('Cookie', adminCookie).expect(200);
    expect(result.body.registrations).toBe(overview.body.registrations);
    expect(result.body.paid).toBe(overview.body.paid);
    expect(result.body.netRevenueByCurrency).toEqual(overview.body.revenueByCurrency.map((row: { currency: string; netRevenue: number }) => ({ currency: row.currency, netRevenue: row.netRevenue })));
    for (const currency of overview.body.revenueByCurrency) {
      const chartTotal = result.body.revenueSeriesByCurrency.find((row: { currency: string }) => row.currency === currency.currency)?.series.reduce((sum: number, point: { netRevenue: number }) => sum + point.netRevenue, 0) ?? 0;
      expect(chartTotal).toBe(currency.netRevenue);
    }
  });

  it('returns valid empty charts, remains Admin-only, and rejects bad input without a 500', async () => {
    await request(app).get('/api/v1/admin/overview/charts').expect(401);
    await request(app).get('/api/v1/admin/overview/charts').set('Cookie', assistantCookie).expect(403);
    const empty = await request(app).get('/api/v1/admin/overview/charts?from=2030-01-01&to=2030-01-03').set('Cookie', adminCookie).expect(200);
    expect(empty.body).toMatchObject({ registrations: 0, paid: 0, registrationsSeries: [], revenueSeriesByCurrency: [], funnel: { registered: 0, contacted: 0, awaitingPayment: 0, paid: 0, cancelled: 0 }, paymentStatusDistribution: [], byCourse: [] });
    await request(app).get('/api/v1/admin/overview?from=not-a-date').set('Cookie', adminCookie).expect(422);
    await request(app).get('/api/v1/admin/overview/charts?to=2026-99-99').set('Cookie', adminCookie).expect(422);
  });
});

describe('BE-4B public settings and SEO', () => {
  it('exposes only the validated registration WhatsApp template from public settings', async () => {
    const settings = await readSettings();
    settings.messageTemplates = new Map([['registration', 'أهلًا {name} بخصوص {course} رقم {reference}'], ['admin-secret', 'secret private template']]);
    settings.staffDefaultPermissions = ['viewSettings'];
    (settings as unknown as { privateApiKey: string }).privateApiKey = 'never expose this private field';
    await settings.save();
    const result = publicSettings(settings);
    expect(result.whatsappMessageTemplate).toContain('{reference}');
    expect(JSON.stringify(result)).not.toContain('secret private template');
    expect(JSON.stringify(result)).not.toContain('never expose this private field');
    expect(result).not.toHaveProperty('messageTemplates');
    expect(result).not.toHaveProperty('staffDefaultPermissions');
    const http = await request(app).get('/api/v1/settings/public').expect(200);
    expect(http.body).toHaveProperty('whatsappMessageTemplate');
    expect(JSON.stringify(http.body)).not.toContain('admin-secret');
  });

  it('renders escaped crawler metadata, canonicalizes old slugs, returns identical unavailable 404s and builds sitemap/robots', async () => {
    const hostileTitle = 'كورس "<script>alert(1)</script>" & تفاصيل';
    const published = await createCourse('seo-current', { title: hostileTitle, oldSlug: 'seo-previous', noindex: true, image: 'media/seo-cover.webp' });
    const page = await request(app).get('/api/v1/seo/courses/seo-previous').expect(200);
    expect(page.headers['content-type']).toContain('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toContain('max-age=300');
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).toContain('href="https://academy.example/ar/courses/seo-current"');
    expect(page.text).toContain('og:locale" content="ar_EG"');
    expect(page.text).toContain('og:image" content="https://cdn.example/media/seo-cover.webp"');
    expect(page.text).toContain('name="robots" content="noindex, nofollow"');
    const draft = await createCourse('seo-draft', { status: 'draft' });
    const deleted = await createCourse('seo-deleted');
    await Course.updateOne({ _id: deleted._id }, { $set: { deletedAt: new Date() } });
    const [unknown, unavailableDraft, archived] = await Promise.all([
      request(app).get('/api/v1/seo/courses/not-found'),
      request(app).get(`/api/v1/seo/courses/${draft.slug}`),
      (async () => { await Course.updateOne({ _id: published._id }, { $set: { status: 'archived' } }); return request(app).get('/api/v1/seo/courses/seo-current'); })(),
    ]);
    expect(unknown.status).toBe(404); expect(unavailableDraft.status).toBe(404); expect(archived.status).toBe(404);
    expect(unknown.text).toBe(unavailableDraft.text); expect(unknown.text).toBe(archived.text);
    const unavailableDeleted = await request(app).get('/api/v1/seo/courses/seo-deleted').expect(404);
    expect(unknown.text).toBe(unavailableDeleted.text);
    await Course.updateOne({ _id: published._id }, { $set: { status: 'published' } });
    const indexable = await createCourse('seo-indexable', { noindex: false });
    const sitemap = await request(app).get('/api/v1/seo/sitemap.xml').expect(200);
    expect(sitemap.text).toContain('/ar/courses/seo-indexable');
    expect(sitemap.text).not.toContain('/ar/courses/seo-current');
    expect(sitemap.text).not.toContain('/ar/courses/seo-draft');
    expect(sitemap.text).toContain('<lastmod>2026-10-01T10:00:00.000Z</lastmod>');
    const robots = await request(app).get('/api/v1/seo/robots.txt').expect(200);
    expect(robots.text).toContain('Sitemap: https://academy.example/sitemap.xml');
    expect(indexable).toBeTruthy();
  });
});
