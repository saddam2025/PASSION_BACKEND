import 'dotenv/config';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { AuditLog } from '../models/AuditLog';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Media } from '../models/Media';
import { Payment } from '../models/Payment';
import { User } from '../models/User';
import type { UserDocument } from '../models/User';
import { assertEnrollmentExportLimit, ENROLLMENT_EXPORT_MAX_ROWS } from '../services/enrollmentExportService';
import { createAccessToken } from '../services/authTokens';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-4D integration tests require MONGODB_URI_TEST.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-4D integration tests require NODE_ENV=test.');

const environment = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: uri,
  ACCESS_TOKEN_SECRET: 'be4d-test-access-secret-long-enough-0001', REFRESH_TOKEN_SECRET: 'be4d-test-refresh-secret-long-enough-0002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});
const origin = 'http://localhost:5173';
const logger = pino({ level: 'silent' });
const app = createApp(environment, { logger, rateLimitMax: 500 });
const owned = [AuditLog, Course, Enrollment, Lead, Media, Payment].map((model) => model.collection.name);
let admin: UserDocument;
let assistant: UserDocument;
let adminToken: string;
let assistantToken: string;
let referenceCounter = 222_222;

function authCookie(token: string, csrf?: string) {
  return `passion_access=${token}${csrf ? `; passion_csrf=${csrf}` : ''}`;
}
function postAs(token: string, csrf: string, path: string) {
  return request(app).post(path).set('Cookie', authCookie(token, csrf)).set('Origin', origin).set('X-CSRF-Token', csrf);
}
function paymentBody(overrides: Record<string, unknown> = {}) {
  return { kind: 'payment', amount: 1_000, currency: 'EGP', method: 'cash', receivedAt: new Date().toISOString(), idempotencyKey: `be4d-${crypto.randomUUID()}`, ...overrides };
}
async function createCourse(title: string) {
  return Course.create({
    slug: `be4d-${crypto.randomUUID()}`, slugHistory: [], status: 'draft', featured: false, createdBy: admin._id,
    draft: { details: { title: { ar: title }, shortDescription: { ar: 'وصف خاص لا يظهر في خيارات التسجيل' } }, page: { schemaVersion: 1, sections: [] }, form: { fields: [] }, seo: {} },
  });
}
async function createEnrollment(courseId: mongoose.Types.ObjectId, title: string, fullName = 'متدرب') {
  referenceCounter += 1;
  const suffix = String(referenceCounter).padStart(6, '2');
  const lead = await Lead.create({ fullName, email: `be4d-${crypto.randomUUID()}@example.test`, phone: '01012345678', phoneNormalized: `2010${String(referenceCounter).padStart(8, '0')}`, consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {} });
  return Enrollment.create({
    reference: `PAS-${suffix}`, leadId: lead._id, courseId,
    courseSnapshot: { title: { ar: title }, slug: `be4d-course-${referenceCounter}` },
    priceSnapshot: { amount: 10_000, currency: 'EGP' }, consent: { acceptedAt: new Date(), policyVersion: 1 },
    formSnapshot: { fields: [] }, answers: {}, enrollmentStatus: 'pending', followUpStatus: 'new', isActive: true,
    registeredAt: new Date(), idempotencyKey: `be4d-enrollment-${crypto.randomUUID()}`,
  });
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, [...owned, User.collection.name]);
  const users = await User.create([
    { email: 'be4d-admin@example.test', name: 'مسؤول الاختبار', role: 'admin', passwordHash: 'be4d-admin-password-hash-long-enough', isActive: true },
    { email: 'be4d-assistant@example.test', name: 'مساعد الاختبار', role: 'assistant', passwordHash: 'be4d-assistant-password-hash-long-enough', permissions: { exportCsv: true, viewSettings: true }, isActive: true },
  ]);
  admin = users[0]!;
  assistant = users[1]!;
  adminToken = createAccessToken(admin, environment);
  assistantToken = createAccessToken(assistant, environment);
}, 60_000);

afterEach(async () => { vi.restoreAllMocks(); await clearNamedCollections(mongoose.connection, owned); });
afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await clearNamedCollections(mongoose.connection, [...owned, User.collection.name]);
    await mongoose.disconnect();
  }
});

describe('BE-4D enrollment filter options and payment receipt projections (Atlas passion_test)', () => {
  it('shows only courses with visible enrollments to Admin and Assistant and filters enrollment rows by course id', async () => {
    const alpha = await createCourse('ألفا');
    const beta = await createCourse('بيتا');
    const unused = await createCourse('غير مستخدم');
    const orphanCourse = await createCourse('تسجيل غير مرئي');
    const alphaEnrollment = await createEnrollment(alpha._id, 'ألفا');
    await createEnrollment(beta._id, 'بيتا');
    const orphanEnrollment = await createEnrollment(orphanCourse._id, 'تسجيل غير مرئي');
    await Lead.deleteOne({ _id: orphanEnrollment.leadId });

    const expected = { courses: [{ id: String(alpha._id), title: 'ألفا' }, { id: String(beta._id), title: 'بيتا' }] };
    const adminFilters = await request(app).get('/api/v1/enrollments/filters').set('Cookie', authCookie(adminToken)).expect(200);
    const assistantFilters = await request(app).get('/api/v1/enrollments/filters').set('Cookie', authCookie(assistantToken)).expect(200);
    expect(adminFilters.body).toEqual(expected);
    expect(assistantFilters.body).toEqual(expected);
    expect(assistantFilters.body.courses[0]).toEqual({ id: String(alpha._id), title: 'ألفا' });
    expect(JSON.stringify(assistantFilters.body)).not.toContain('وصف خاص');
    expect(assistantFilters.body.courses.map((course: { id: string }) => course.id)).not.toContain(String(unused._id));
    expect(assistantFilters.body.courses.map((course: { id: string }) => course.id)).not.toContain(String(orphanCourse._id));

    const filtered = await request(app).get(`/api/v1/enrollments?courseId=${alpha._id}`).set('Cookie', authCookie(assistantToken)).expect(200);
    expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([String(alphaEnrollment._id)]);
  });

  it('returns attached receipt ids to payment readers, null without a receipt, and blocks callers without payment rights', async () => {
    const courseId = new mongoose.Types.ObjectId();
    const withReceipt = await createEnrollment(courseId, 'كورس الإيصال');
    const withoutReceipt = await createEnrollment(courseId, 'كورس بدون إيصال');
    const receiptKey = `receipts/2026/11/${'a'.repeat(40)}.pdf`;
    const receipt = await Media.create({ key: receiptKey, bucket: 'private', mime: 'application/pdf', size: 10, uploadedBy: admin._id, usages: [] });

    const created = await postAs(adminToken, 'be4d-csrf-token', `/api/v1/enrollments/${withReceipt._id}/payments`)
      .send(paymentBody({ receiptMediaKey: receiptKey })).expect(201);
    expect(created.body.payment.receiptId).toBe(String(receipt._id));
    expect(created.body.payment).not.toHaveProperty('bucket');
    expect(created.body.payment).not.toHaveProperty('url');
    const noReceiptCreated = await postAs(adminToken, 'be4d-csrf-token', `/api/v1/enrollments/${withoutReceipt._id}/payments`)
      .send(paymentBody()).expect(201);
    expect(noReceiptCreated.body.payment.receiptId).toBeNull();

    const list = await request(app).get(`/api/v1/enrollments/${withReceipt._id}/payments`).set('Cookie', authCookie(assistantToken)).expect(200);
    expect(list.body.items[0].receiptId).toBe(String(receipt._id));
    expect(list.body.items[0]).not.toHaveProperty('bucket');
    expect(list.body.items[0]).not.toHaveProperty('url');
    const noReceiptList = await request(app).get(`/api/v1/enrollments/${withoutReceipt._id}/payments`).set('Cookie', authCookie(adminToken)).expect(200);
    expect(noReceiptList.body.items[0].receiptId).toBeNull();

    const unauthenticated = await request(app).get(`/api/v1/enrollments/${withReceipt._id}/payments`).expect(401);
    expect(JSON.stringify(unauthenticated.body)).not.toContain('receiptId');
    await request(app).get(`/api/v1/payments?courseId=${courseId}`).expect(401);
  });
});

describe('BE-4D POST CSV export', () => {
  it('applies body search, requires Admin and CSRF, preserves safe CSV/audit behavior, and keeps GET search disabled', async () => {
    const courseId = new mongoose.Types.ObjectId();
    const marker = `be4d-search-${crypto.randomUUID()}`;
    await createEnrollment(courseId, 'كورس التصدير', `=SUM(1,2) ${marker}`);
    await createEnrollment(courseId, 'كورس آخر', 'متدرب آخر');

    const missingCsrf = await request(app).post('/api/v1/enrollments/export.csv').set('Cookie', authCookie(adminToken)).set('Origin', origin).send({ search: marker });
    expect(missingCsrf.status).toBe(403);
    await postAs(assistantToken, 'be4d-csrf-token', '/api/v1/enrollments/export.csv').send({ search: marker }).expect(403);

    const exported = await postAs(adminToken, 'be4d-csrf-token', '/api/v1/enrollments/export.csv')
      .send({ search: marker, courseId: String(courseId), sort: 'newest', page: 1, pageSize: 25 }).expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text.startsWith('\uFEFF')).toBe(true);
    expect(exported.text).toContain(`"'=SUM(1,2) ${marker}"`);
    expect(exported.text).not.toContain('متدرب آخر');
    expect(exported.text).not.toMatch(/_id|payloadHash|tokenHash|idempotencyKey/);
    const audit = await AuditLog.findOne({ action: 'enrollments_exported' }).lean();
    expect(audit?.note).toContain('searchProvided');
    expect(audit?.note).not.toContain(marker);

    await request(app).get('/api/v1/enrollments/export.csv').set('Cookie', authCookie(adminToken)).expect(200);
    await request(app).get(`/api/v1/enrollments/export.csv?search=${encodeURIComponent(marker)}`).set('Cookie', authCookie(adminToken)).expect(400);
    expect(() => assertEnrollmentExportLimit(ENROLLMENT_EXPORT_MAX_ROWS + 1)).toThrow(/الحد الأقصى/);
  });

  it('returns the row-cap validation error before starting a POST CSV stream', async () => {
    vi.spyOn(Enrollment, 'aggregate').mockReturnValueOnce(Promise.resolve([{ total: ENROLLMENT_EXPORT_MAX_ROWS + 1 }]) as never);
    const response = await postAs(adminToken, 'be4d-csrf-token', '/api/v1/enrollments/export.csv').send({ search: 'sensitive search text' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
