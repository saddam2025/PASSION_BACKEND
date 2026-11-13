import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { AuditLog } from '../models/AuditLog';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Note } from '../models/Note';
import { Notification } from '../models/Notification';
import { RefreshToken } from '../models/RefreshToken';
import { User } from '../models/User';
import { hashPassword } from '../services/passwords';
import { cairoDayRange } from '../lib/time';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-5B integration tests require MONGODB_URI_TEST; skipped tests are not accepted.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-5B integration tests require NODE_ENV=test.');
const env = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: uri,
  ACCESS_TOKEN_SECRET: 'be5b-test-access-secret-long-enough-0001', REFRESH_TOKEN_SECRET: 'be5b-test-refresh-secret-long-enough-0002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});
const logger = createLogger('silent');
const origin = 'http://localhost:5173';
const adminPassword = 'AdminPassphrase7!';
const assistantPassword = 'AssistantPhrase8!';
const app = createApp(env, { logger, rateLimitMax: 500 });
const collections = [AuditLog, Course, Enrollment, Lead, Note, Notification, RefreshToken].map((model) => model.collection.name);
const client = () => request.agent(app);
type Client = ReturnType<typeof client>;
async function login(target: Client, email: string, password: string) {
  const csrf = await target.get('/api/v1/auth/csrf').expect(200);
  await target.post('/api/v1/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf.body.csrfToken).send({ email, password }).expect(200);
  return { target, csrf: csrf.body.csrfToken as string };
}
function write(session: { target: Client; csrf: string }, method: 'post' | 'patch', path: string, body: unknown = {}) {
  return session.target[method](path).set('Origin', origin).set('X-CSRF-Token', session.csrf).send(body as object);
}
async function createLead(index: number, overrides: Record<string, unknown> = {}) {
  return Lead.create({
    fullName: `عميل ${index}`, email: `customer-${index}@example.test`, phone: `010123456${String(index).padStart(2, '0')}`,
    phoneNormalized: `2010123456${String(index).padStart(2, '0')}`,
    consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {}, ...overrides,
  });
}
async function createEnrollment(index: number, options: { leadId?: mongoose.Types.ObjectId; date?: Date; status?: 'pending' | 'confirmed' | 'cancelled'; follow?: string; assignedTo?: mongoose.Types.ObjectId | null; courseId?: mongoose.Types.ObjectId } = {}) {
  const lead = options.leadId ? await Lead.findById(options.leadId) : await createLead(index);
  const courseId = options.courseId ?? new mongoose.Types.ObjectId();
  const status = options.status ?? 'pending';
  return Enrollment.create({
    reference: `PAS-${['2','3','4','5','6','7'][index % 6]}${['A','B','C','D','E','F'][index % 6]}${['G','H','J','K','L','M'][index % 6]}${['N','P','Q','R','S','T'][index % 6]}${['U','V','W','X','Y','Z'][index % 6]}${['2','3','4','5','6','7'][index % 6]}`,
    leadId: lead!._id, courseId, courseSnapshot: { title: { ar: `كورس ${index}` }, slug: `course-${index}` },
    priceSnapshot: { amount: 10_000, currency: 'EGP' }, consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: { answer: 'قيمة' },
    enrollmentStatus: status, followUpStatus: options.follow ?? 'new', isActive: status !== 'cancelled', assignedTo: options.assignedTo ?? null,
    registeredAt: options.date ?? new Date(), idempotencyKey: `be5b-enrollment-${index}-${crypto.randomUUID()}`,
    history: [{ at: new Date(), by: new mongoose.Types.ObjectId(), from: 'new', to: 'new', note: 'حدث سابق' }],
  });
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, [...collections, User.collection.name]);
  await User.create([
    { email: 'be5b-admin@example.test', name: 'مسؤول الاختبار', role: 'admin', passwordHash: await hashPassword(adminPassword), permissions: {}, isActive: true },
    { email: 'be5b-assistant@example.test', name: 'مساعد الاختبار', role: 'assistant', passwordHash: await hashPassword(assistantPassword), permissions: {}, isActive: true },
    { email: 'be5b-inactive@example.test', name: 'مساعد غير نشط', role: 'assistant', passwordHash: await hashPassword(assistantPassword), permissions: {}, isActive: false },
  ]);
}, 60_000);
afterEach(async () => clearNamedCollections(mongoose.connection, collections));
afterAll(async () => { if (mongoose.connection.readyState === 1) { await clearNamedCollections(mongoose.connection, [...collections, User.collection.name]); await mongoose.disconnect(); } });

describe('BE-5B staff records (MongoDB integration)', () => {
  it('filters, searches, sorts and paginates enrollments with max page size and Cairo day boundaries', async () => {
    const admin = (await User.findOne({ role: 'admin' }))!;
    const courseId = new mongoose.Types.ObjectId();
    const assigned = new mongoose.Types.ObjectId();
    const first = await createEnrollment(1, { date: new Date('2026-01-31T22:00:00.000Z'), courseId, assignedTo: admin._id, follow: 'contacted' });
    await createEnrollment(2, { date: new Date('2026-02-02T12:00:00.000Z'), courseId, follow: 'new' });
    const session = await login(client(), 'be5b-admin@example.test', adminPassword);
    const response = await session.target.get(`/api/v1/enrollments?courseId=${courseId}&followUpStatus=contacted&dateFrom=2026-02-01&dateTo=2026-02-01&sort=oldest&pageSize=50`).expect(200);
    expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(response.body.items[0]).toMatchObject({ reference: first.reference, lead: { fullName: 'عميل 1' }, courseTitle: { ar: 'كورس 1' }, assignedTo: { id: String(admin._id), name: { ar: 'مسؤول الاختبار' } } });
    expect(response.body.items[0]).not.toHaveProperty('paymentStatus');
    expect((await session.target.get('/api/v1/enrollments?search=customer-1').expect(200)).body.total).toBe(1);
    expect((await session.target.get('/api/v1/enrollments?sort=name').expect(200)).body.items[0].lead.fullName).toBe('عميل 1');
    expect((await session.target.get('/api/v1/enrollments?pageSize=51').expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect(cairoDayRange('2026-02-01').from?.toISOString()).toBe('2026-01-31T22:00:00.000Z');
    expect(assigned).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  it('returns detail without secrets or unrelated lead data and normalizes invalid/missing ids to the same 404', async () => {
    const enrollment = await createEnrollment(3);
    const unrelated = await createEnrollment(4);
    const admin = (await User.findOne({ role: 'admin' }))!;
    enrollment.history.push({ at: new Date(), by: admin._id, from: 'pending', to: 'confirmed', note: 'تم التأكيد' });
    await enrollment.save();
    await Note.create({ enrollmentId: enrollment._id, authorId: admin._id, body: 'ملاحظة داخلية' });
    const session = await login(client(), 'be5b-admin@example.test', adminPassword);
    const detail = await session.target.get(`/api/v1/enrollments/${enrollment._id}`).expect(200);
    expect(detail.body.enrollment).toMatchObject({ reference: enrollment.reference, lead: { fullName: 'عميل 3' }, answers: { answer: 'قيمة' }, notes: [{ body: 'ملاحظة داخلية' }], otherEnrollments: [] });
    expect(detail.body.enrollment.history.at(-1).by.name.ar).toBe('مسؤول الاختبار');
    expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|tokenHash|idempotencyHash|refreshToken|secret/);
    expect(JSON.stringify(detail.body)).not.toContain('customer-4@example.test');
    expect(unrelated.leadId.toString()).not.toBe(enrollment.leadId.toString());
    const bad = await session.target.get('/api/v1/enrollments/not-an-id');
    const missing = await session.target.get(`/api/v1/enrollments/${new mongoose.Types.ObjectId()}`);
    expect(bad.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(bad.body.error).toMatchObject({ code: missing.body.error.code, message: missing.body.error.message });
  });

  it('enforces auth, CSRF and Assistant permissions while allowing default follow-up and notes actions', async () => {
    const enrollment = await createEnrollment(5);
    await request(app).get('/api/v1/enrollments').expect(401);
    const assistant = await login(client(), 'be5b-assistant@example.test', assistantPassword);
    await assistant.target.get(`/api/v1/enrollments/${enrollment._id}`).expect(200);
    await write(assistant, 'patch', `/api/v1/enrollments/${enrollment._id}/follow-up`, { followUpStatus: 'contacted', note: 'تم الاتصال' }).expect(200);
    await write(assistant, 'post', `/api/v1/enrollments/${enrollment._id}/notes`, { body: 'ملاحظة <b>مهمة</b>\u0000' }).expect(201);
    expect((await assistant.target.get(`/api/v1/enrollments/${enrollment._id}/notes`).expect(200)).body.items[0].body).toBe('ملاحظة مهمة');
    await assistant.target.post(`/api/v1/enrollments/${enrollment._id}/assign`).set('Origin', origin).set('X-CSRF-Token', assistant.csrf).send({ assigneeId: null }).expect(403);
    await write(assistant, 'post', `/api/v1/enrollments/${enrollment._id}/confirm`, { reason: 'تم التحقق' }).expect(403);
    await write(assistant, 'post', `/api/v1/enrollments/${enrollment._id}/cancel`, { reason: 'بناءً على الطلب' }).expect(403);
    await assistant.target.patch(`/api/v1/enrollments/${enrollment._id}/follow-up`).send({ followUpStatus: 'interested' }).expect(403);
    await assistant.target.patch(`/api/v1/enrollments/${enrollment._id}/notes/${new mongoose.Types.ObjectId()}`).expect(404);
    await assistant.target.delete(`/api/v1/enrollments/${enrollment._id}/notes`).expect(404);
    expect(await Note.findOne({ enrollmentId: enrollment._id }).lean()).toMatchObject({ body: 'ملاحظة مهمة' });
    const auditEvents = await AuditLog.find({ entityType: 'enrollment', entityId: enrollment._id }).lean();
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents.map((event) => event.action).sort()).toEqual(['enrollment.follow_up_changed', 'enrollment.note_added']);
    expect(JSON.stringify(auditEvents)).not.toMatch(/customer-5@example\.test|01012345605|ملاحظة مهمة/);
  });

  it('assigns only active staff, validates follow-up transitions, logs WhatsApp without claiming a sent message, and audits mutations', async () => {
    const enrollment = await createEnrollment(6);
    const admin = await login(client(), 'be5b-admin@example.test', adminPassword);
    const assistantUser = (await User.findOne({ role: 'assistant', isActive: true }))!;
    const inactive = (await User.findOne({ email: 'be5b-inactive@example.test' }))!;
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/assign`, { assigneeId: String(assistantUser._id) }).expect(200);
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/assign`, { assigneeId: String(inactive._id) }).expect(422);
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/assign`, { assigneeId: '000000000000000000000000' }).expect(422);
    const historyCountBeforeRepeat = (await Enrollment.findById(enrollment._id).select('history').lean())!.history.length;
    const auditCountBeforeRepeat = await AuditLog.countDocuments({ entityId: enrollment._id });
    const repeatedFollowUp = await write(admin, 'patch', `/api/v1/enrollments/${enrollment._id}/follow-up`, { followUpStatus: 'new' }).expect(200);
    expect(repeatedFollowUp.body.enrollment.followUpStatus).toBe('new');
    expect(repeatedFollowUp.body.enrollment.history).toHaveLength(historyCountBeforeRepeat);
    expect(await AuditLog.countDocuments({ entityId: enrollment._id })).toBe(auditCountBeforeRepeat);
    const logged = await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/whatsapp-contact`).expect(200);
    expect(logged.body.enrollment.followUpStatus).toBe('new');
    expect(logged.body.enrollment.history.at(-1).note).toContain('من غير تأكيد إرسال رسالة');
    expect(await AuditLog.countDocuments({ entityId: enrollment._id })).toBe(2);
  });

  it('keeps follow-up independent from cancellation and records each real change once', async () => {
    const enrollment = await createEnrollment(8, { status: 'cancelled', follow: 'interested' });
    const admin = await login(client(), 'be5b-admin@example.test', adminPassword);

    const updated = await write(admin, 'patch', `/api/v1/enrollments/${enrollment._id}/follow-up`, {
      followUpStatus: 'closed', note: 'تم إنهاء المتابعة',
    }).expect(200);
    expect(updated.body.enrollment).toMatchObject({ enrollmentStatus: 'cancelled', followUpStatus: 'closed', isActive: false });
    expect(updated.body.enrollment.history.at(-1)).toMatchObject({ from: 'interested', to: 'closed', note: 'تم إنهاء المتابعة' });

    const historyCount = updated.body.enrollment.history.length;
    await write(admin, 'patch', `/api/v1/enrollments/${enrollment._id}/follow-up`, { followUpStatus: 'closed' }).expect(200);
    const stored = await Enrollment.findById(enrollment._id).lean();
    expect(stored).toMatchObject({ enrollmentStatus: 'cancelled', followUpStatus: 'closed', isActive: false });
    expect(stored?.history).toHaveLength(historyCount);
    expect(await AuditLog.countDocuments({ entityId: enrollment._id, action: 'enrollment.follow_up_changed' })).toBe(1);
  });

  it('requires confirmation reason, cancellation reason and deactivates cancelled enrollment for a new registration', async () => {
    const adminUser = (await User.findOne({ role: 'admin' }))!;
    const snapshot = { details: { title: { ar: 'كورس إعادة التسجيل' }, pricing: { price: 10_000, promo: 8_000, currency: 'EGP' }, enrollment: { registrationOpen: true, capacity: null } }, page: { schemaVersion: 1, sections: [] }, form: { fields: [] }, seo: {} };
    const course = await Course.create({ slug: 'staff-reopen-course', status: 'published', createdBy: adminUser._id, published: snapshot, draft: snapshot });
    const lead = await createLead(7, { email: 'reopen-customer@example.test' });
    const enrollment = await createEnrollment(7, { leadId: lead._id, courseId: course._id });
    const admin = await login(client(), 'be5b-admin@example.test', adminPassword);
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/confirm`, {}).expect(422);
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/confirm`, { reason: 'من غير دفع' }).expect(200);
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/cancel`, {}).expect(400);
    await write(admin, 'post', `/api/v1/enrollments/${enrollment._id}/cancel`, { reason: 'بناءً على طلب العميل' }).expect(200);
    expect(await Enrollment.findById(enrollment._id).lean()).toMatchObject({ enrollmentStatus: 'cancelled', isActive: false, cancelledReason: 'بناءً على طلب العميل' });
    const resubmission = await request(app).post('/api/v1/public/registrations').set('Origin', origin).send({ courseSlug: course.slug, fullName: lead.fullName, email: lead.email, phone: lead.phone, answers: {}, consent: true, idempotencyKey: `be5b-reopen-${crypto.randomUUID()}`, formStartedAt: Date.now() - 2_500 });
    expect(resubmission.status, JSON.stringify(resubmission.body)).toBe(201);
    expect(resubmission.body.reference).not.toBe(enrollment.reference);
    expect(await Enrollment.countDocuments({ leadId: enrollment.leadId, courseId: enrollment.courseId, isActive: true })).toBe(1);
    expect(await Enrollment.countDocuments({ leadId: enrollment.leadId, courseId: enrollment.courseId })).toBe(2);
    expect(await AuditLog.countDocuments({ entityId: enrollment._id })).toBe(2);
  });

  it('scopes notifications to the current user and supports unread count, read and read-all with CSRF', async () => {
    const adminUser = (await User.findOne({ role: 'admin' }))!;
    const assistantUser = (await User.findOne({ role: 'assistant', isActive: true }))!;
    const entityId = new mongoose.Types.ObjectId();
    const created = await Notification.create([
      { recipientId: adminUser._id, type: 'new_registration', params: { reference: 'PAS-ABC234' }, entityType: 'enrollment', entityId },
      { recipientId: assistantUser._id, type: 'new_registration', params: { reference: 'PAS-XYZ234' }, entityType: 'enrollment', entityId: new mongoose.Types.ObjectId() },
    ]);
    const mine = created[0]!;
    const theirs = created[1]!;
    const admin = await login(client(), 'be5b-admin@example.test', adminPassword);
    expect((await admin.target.get('/api/v1/notifications?unreadOnly=true').expect(200)).body.total).toBe(1);
    expect((await admin.target.get('/api/v1/notifications/unread-count').expect(200)).body.count).toBe(1);
    expect(JSON.stringify((await admin.target.get('/api/v1/notifications').expect(200)).body)).not.toContain('PAS-XYZ234');
    await write(admin, 'post', `/api/v1/notifications/${theirs._id}/read`).expect(404);
    await admin.target.post(`/api/v1/notifications/${mine._id}/read`).set('Origin', origin).send({}).expect(403);
    await write(admin, 'post', `/api/v1/notifications/${mine._id}/read`).expect(200);
    expect((await admin.target.get('/api/v1/notifications/unread-count').expect(200)).body.count).toBe(0);
    await Notification.create({ recipientId: adminUser._id, type: 'system', params: {}, entityType: 'system', entityId: new mongoose.Types.ObjectId() });
    await write(admin, 'post', '/api/v1/notifications/read-all').expect(200);
    expect((await admin.target.get('/api/v1/notifications/unread-count').expect(200)).body.count).toBe(0);
    expect(await Notification.countDocuments({ recipientId: assistantUser._id })).toBe(1);
    expect(await AuditLog.countDocuments({ entityType: 'notification' })).toBe(1);
  });

  it('returns lead-level enrollment counts separately and only references for related registrations', async () => {
    const lead = await createLead(9);
    const own = await createEnrollment(10, { leadId: lead._id });
    const other = await createEnrollment(11);
    lead.possibleDuplicateOf = other.leadId;
    await lead.save();
    const session = await login(client(), 'be5b-assistant@example.test', assistantPassword);
    const response = await session.target.get(`/api/v1/leads/${lead._id}`).expect(200);
    expect(response.body).toMatchObject({ counts: { leads: 1, enrollments: 1 }, enrollments: [{ reference: own.reference }], possibleDuplicateOf: { hasPossibleDuplicate: true, references: [other.reference] } });
    expect(JSON.stringify(response.body)).not.toContain('customer-11@example.test');
  });
});
