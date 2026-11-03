import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Notification } from '../models/Notification';
import { Settings } from '../models/Settings';
import { AuditLog } from '../models/AuditLog';
import { User } from '../models/User';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-5A registration integration tests require MONGODB_URI_TEST; skipped tests are not accepted.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-5A registration tests require NODE_ENV=test.');

const environment = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: uri,
  ACCESS_TOKEN_SECRET: 'be5a-test-access-secret-long-enough-0001',
  REFRESH_TOKEN_SECRET: 'be5a-test-refresh-secret-long-enough-0002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173',
  APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});
const logger = createLogger('silent');
const origin = 'http://localhost:5173';
const models = [Course, Enrollment, Lead, Notification, Settings, AuditLog, User];
const collections = [...new Set(models.map((model) => model.collection.name))];
const app = createApp(environment, { logger, rateLimitMax: 500 });
const answerFields = [
  { id: 'goal', type: 'text', label: { ar: 'هدفك' }, required: true, maxLength: 120 },
  { id: 'track', type: 'select', label: { ar: 'المسار' }, required: true, options: [{ value: 'design', label: { ar: 'تصميم' } }, { value: 'business', label: { ar: 'أعمال' } }] },
  { id: 'updates', type: 'checkbox', label: { ar: 'تحديثات' }, required: false },
  { id: 'agreement', type: 'checkbox', label: { ar: 'أوافق على الشروط' }, required: true },
  { id: 'bio', type: 'textarea', label: { ar: 'نبذة' }, required: false, maxLength: 400 },
  { id: 'contact-email', type: 'email', label: { ar: 'بريد إضافي' }, required: false, maxLength: 120 },
  { id: 'contact-phone', type: 'phone', label: { ar: 'رقم إضافي' }, required: false, maxLength: 24 },
  { id: 'experience', type: 'radio', label: { ar: 'الخبرة' }, required: false, options: [{ value: 'new', label: { ar: 'مبتدئ' } }, { value: 'experienced', label: { ar: 'لدي خبرة' } }] },
];
const requestAgent = () => request(app);
const validBody = (overrides: Record<string, unknown> = {}) => ({
  courseSlug: 'registration-course',
  fullName: '  سارة أحمد  ',
  email: `person-${crypto.randomUUID()}@example.test`,
  phone: '01012345678',
  answers: { goal: 'تطوير المهارات', track: 'design', updates: false, agreement: true },
  consent: true,
  idempotencyKey: `key-${crypto.randomUUID()}`,
  formStartedAt: Date.now() - 2_500,
  attribution: { utm_source: 'newsletter', utm_medium: 'email', referrer: 'https://example.test/course?email=private@example.test' },
  ...overrides,
});

function postRegistration(body: Record<string, unknown>, target = requestAgent()) {
  return target.post('/api/v1/public/registrations').set('Origin', origin).send(body);
}

async function createCourse(overrides: { slug?: string; status?: string; registrationOpen?: boolean; capacity?: number | null; deletedAt?: Date | null; price?: number | null; promo?: number | null; title?: string } = {}) {
  const details = {
    title: { ar: overrides.title ?? 'كورس تجريبي' },
    pricing: { price: overrides.price ?? 10_000, promo: overrides.promo ?? 8_000, currency: 'EGP' },
    enrollment: { registrationOpen: overrides.registrationOpen ?? true, capacity: overrides.capacity ?? null },
  };
  const snapshot = { details, page: { schemaVersion: 1, sections: [] }, form: { fields: answerFields }, seo: {} };
  return Course.create({
    slug: overrides.slug ?? 'registration-course',
    status: overrides.status ?? 'published',
    createdBy: new mongoose.Types.ObjectId(),
    deletedAt: overrides.deletedAt ?? null,
    published: overrides.status === 'draft' ? null : snapshot,
    draft: snapshot,
  });
}

async function createUser(email: string, role: 'admin' | 'assistant', active = true, viewLeads = true) {
  return User.create({
    email, name: role === 'admin' ? 'مسؤول تجريبي' : 'مساعد تجريبي', passwordHash: 'test-password-hash-value-000000000000000',
    role, permissions: { viewLeads, updateFollowUp: false, viewPayments: false, recordPayments: false, exportCsv: false, viewFinancialReports: false, manageNotes: false }, isActive: active,
  });
}

async function createExistingActiveEnrollment(courseId: mongoose.Types.ObjectId, email: string, reference: string) {
  const lead = await Lead.create({
    fullName: 'عميل موجود', email, phone: '+201012345678', phoneNormalized: '201012345678',
    consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {},
  });
  return Enrollment.create({
    reference, leadId: lead._id, courseId, courseSnapshot: { title: { ar: 'كورس تجريبي' }, slug: 'registration-course' },
    priceSnapshot: { amount: 8_000, currency: 'EGP' }, consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: {},
    enrollmentStatus: 'pending', followUpStatus: 'new', isActive: true, registeredAt: new Date(), idempotencyKey: `existing-${reference}`,
  });
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, collections);
}, 60_000);

afterEach(async () => {
  vi.restoreAllMocks();
  await clearNamedCollections(mongoose.connection, collections);
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await clearNamedCollections(mongoose.connection, collections);
    await mongoose.disconnect();
  }
});

describe('BE-5A public registrations', () => {
  it('happy path creates a lead, enrollment snapshot, safe audit event and per-user notifications', async () => {
    await createCourse();
    const admin = await createUser('admin-recipient@example.test', 'admin');
    const assistant = await createUser('assistant-recipient@example.test', 'assistant', true, true);
    await createUser('inactive-recipient@example.test', 'assistant', false, true);
    const submission = validBody({ answers: { goal: '  <b>تطوير المهارات</b>\u0000', track: 'design', updates: false, agreement: true, 'contact-email': '  EXTRA@Example.test ', 'contact-phone': '01123456789', experience: 'new' }, attribution: { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'fall-launch', referrer: 'https://example.test/course?email=private@example.test' } });
    const response = await postRegistration(submission);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toEqual({ reference: expect.stringMatching(/^PAS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/), status: 'received' });
    expect(JSON.stringify(response.body)).not.toMatch(/_id|leadId|courseId|tokenHash|email|phone/);
    const persistedLead = await Lead.findOne({ email: String(submission.email).toLowerCase() }).lean();
    const enrollment = await Enrollment.findOne({ reference: response.body.reference }).lean();
    expect(persistedLead).toMatchObject({ fullName: 'سارة أحمد', email: expect.stringMatching(/^person-.*@example\.test$/), phone: '01012345678', phoneNormalized: '201012345678', attribution: { source: 'newsletter', medium: 'email', campaign: 'fall-launch', referrer: 'https://example.test/course', referrerPath: '/course' } });
    expect(enrollment).toMatchObject({ enrollmentStatus: 'pending', followUpStatus: 'new', isActive: true, priceSnapshot: { amount: 8_000, currency: 'EGP' }, courseSnapshot: { title: { ar: 'كورس تجريبي' }, slug: 'registration-course' }, consent: { policyVersion: 1 }, answers: { goal: 'تطوير المهارات', track: 'design', fullName: 'سارة أحمد', email: expect.stringMatching(/^person-.*@example\.test$/), phone: '01012345678', 'contact-email': 'extra@example.test', 'contact-phone': '+201123456789', experience: 'new', agreement: true } });
    expect(enrollment?.formSnapshot?.fields).toEqual(answerFields.map((field) => ({ id: field.id, type: field.type, label: { ar: field.label.ar } })));
    const notifications = await Notification.find({ entityId: enrollment?._id }).lean();
    expect(notifications.map((entry) => String(entry.recipientId)).sort()).toEqual([String(admin._id), String(assistant._id)].sort());
    expect(notifications.every((entry) => entry.type === 'new_registration' && entry.entityType === 'enrollment')).toBe(true);
    expect(JSON.stringify(notifications)).toContain(response.body.reference);
    expect(JSON.stringify(notifications)).toContain('كورس تجريبي');
    expect(JSON.stringify(notifications)).not.toMatch(/سارة|example\.test|01012345678|leadId/);
    const audit = await AuditLog.find({ action: 'registration_created', entityId: enrollment?._id }).lean();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/سارة|example\.test|01012345678|goal|track/);
  });

  it('requires a published, non-deleted course with registration open', async () => {
    await createCourse({ slug: 'unpublished-course', status: 'draft' });
    await createCourse({ slug: 'archived-course', status: 'archived' });
    await createCourse({ slug: 'deleted-course', deletedAt: new Date() });
    await createCourse({ slug: 'closed-course', registrationOpen: false });
    for (const [slug, code] of [['unpublished-course', 'COURSE_NOT_AVAILABLE'], ['archived-course', 'COURSE_NOT_AVAILABLE'], ['deleted-course', 'COURSE_NOT_AVAILABLE'], ['closed-course', 'REGISTRATION_CLOSED']]) {
      const response = await postRegistration(validBody({ courseSlug: slug, email: `${slug}@example.test` }));
      expect(response.status).toBe(code === 'COURSE_NOT_AVAILABLE' ? 404 : 409);
      expect(response.body.error.code).toBe(code);
      expect(response.body.error.message).toMatch(/الكورس|التسجيل/);
    }
    expect(await Lead.countDocuments()).toBe(0);
    expect(await Enrollment.countDocuments()).toBe(0);
  });

  it('rejects a full course based on active enrollment count', async () => {
    const course = await createCourse({ capacity: 1 });
    await createExistingActiveEnrollment(course._id, 'capacity-holder@example.test', 'PAS-ABC234');
    const response = await postRegistration(validBody({ email: 'new-capacity-person@example.test' }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COURSE_FULL');
    expect(response.body.error.message).toBe('الأماكن المتاحة في الكورس اكتملت.');
    expect(await Enrollment.countDocuments({ courseId: course._id })).toBe(1);
    expect(await Lead.countDocuments({ email: 'new-capacity-person@example.test' })).toBe(0);
  });

  it('rejects required-answer omissions and invalid values in canonical and mock answer shapes without writes', async () => {
    await createCourse();
    const baseline = { leads: await Lead.countDocuments(), enrollments: await Enrollment.countDocuments() };
    const canonical = (answers: Array<{ id: string; value: string | boolean }>, email: string) => validBody({
      email, answers, fullName: 'عميل اختبار', phone: '01012345678', consent: true,
    });
    const mockMap = (answers: Record<string, string | boolean>, email: string) => validBody({
      email, answers: { fullName: 'عميل اختبار', phone: '01012345678', consent: true, ...answers },
    });
    const invalidCases = [
      ['canonical required field missing', canonical([{ id: 'track', value: 'design' }, { id: 'agreement', value: true }], 'missing-canonical@example.test')],
      ['mock-map required field missing', mockMap({ track: 'design', agreement: true }, 'missing-map@example.test')],
      ['required value empty string', canonical([{ id: 'goal', value: '' }, { id: 'track', value: 'design' }, { id: 'agreement', value: true }], 'empty-canonical@example.test')],
      ['required value whitespace only', mockMap({ goal: '   ', track: 'design', agreement: true }, 'whitespace-map@example.test')],
      ['required checkbox unchecked', mockMap({ goal: 'هدف', track: 'design', agreement: false }, 'unchecked-box@example.test')],
      ['canonical select value outside options', canonical([{ id: 'goal', value: 'هدف' }, { id: 'track', value: 'invalid' }, { id: 'agreement', value: true }], 'bad-select-canonical@example.test')],
      ['mock-map select value outside options', mockMap({ goal: 'هدف', track: 'invalid', agreement: true }, 'bad-select-map@example.test')],
      ['canonical unknown field id', canonical([{ id: 'goal', value: 'هدف' }, { id: 'track', value: 'design' }, { id: 'agreement', value: true }, { id: 'not-in-form', value: 'value' }], 'unknown-canonical@example.test')],
      ['mock-map unknown field id', mockMap({ goal: 'هدف', track: 'design', agreement: true, notInForm: 'value' }, 'unknown-map@example.test')],
    ] as const;
    for (const [name, body] of invalidCases) {
      const response = await postRegistration(body);
      expect(response.status, name).toBe(422);
      expect(response.body.error.message, name).toBe('راجع بيانات التسجيل وحاول تاني.');
      expect(await Lead.countDocuments(), name).toBe(baseline.leads);
      expect(await Enrollment.countDocuments(), name).toBe(baseline.enrollments);
    }
  });

  it('validates email, phone, checkbox, radio values and text length for published field types', async () => {
    await createCourse();
    const invalidEmail = await postRegistration(validBody({ email: 'bad-field-email@example.test', answers: { goal: 'هدف', track: 'design', 'contact-email': 'not-an-email' } }));
    const invalidPhone = await postRegistration(validBody({ email: 'bad-field-phone@example.test', answers: { goal: 'هدف', track: 'design', 'contact-phone': '12' } }));
    const invalidRadio = await postRegistration(validBody({ email: 'bad-field-radio@example.test', answers: { goal: 'هدف', track: 'design', experience: 'not-an-option' } }));
    const invalidLength = await postRegistration(validBody({ email: 'bad-field-length@example.test', answers: { goal: 'x'.repeat(121), track: 'design' } }));
    expect([invalidEmail.status, invalidPhone.status, invalidRadio.status, invalidLength.status]).toEqual([422, 422, 422, 422]);
    expect(await Enrollment.countDocuments()).toBe(0);
  });

  it('returns neutral success for honeypot, too-fast and implausible future submissions without writes', async () => {
    await createCourse();
    const honeypot = await postRegistration(validBody({ email: 'bot-one@example.test', website: 'filled' })).expect(200);
    const tooFast = await postRegistration(validBody({ email: 'bot-two@example.test', formStartedAt: Date.now() - 100 })).expect(200);
    const future = await postRegistration(validBody({ email: 'bot-three@example.test', formStartedAt: Date.now() + 120_000 })).expect(200);
    for (const response of [honeypot, tooFast, future]) expect(response.body).toMatchObject({ status: 'received', reference: expect.stringMatching(/^PAS-/) });
    expect(await Lead.countDocuments()).toBe(0);
    expect(await Enrollment.countDocuments()).toBe(0);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('accepts the current mock answer map and form-start/honeypot aliases while stripping unknown top-level keys', async () => {
    await createCourse();
    const body = validBody({
      fullName: undefined, email: undefined, phone: undefined, consent: undefined,
      answers: { fullName: 'مستخدم الواجهة', email: ' MOCK@Example.test ', phone: '01123456789', consent: true, goal: 'هدف', track: 'business', agreement: true },
      renderedAt: Date.now() - 2_500, honeypot: '', unrecognized: 'drop-me',
    });
    const response = await postRegistration(body).expect(201);
    expect(Object.keys(response.body).sort()).toEqual(['reference', 'status']);
    expect(await Lead.findOne({ email: 'mock@example.test' }).lean()).toMatchObject({ fullName: 'مستخدم الواجهة', phoneNormalized: '201123456789' });
  });

  it('returns the same reference for idempotent replay and rejects a conflicting payload with the same key', async () => {
    await createCourse();
    const body = validBody({ idempotencyKey: 'idempotency-same-0001', email: 'idempotency@example.test' });
    const first = await postRegistration(body).expect(201);
    const replay = await postRegistration(body).expect(200);
    expect(replay.body).toEqual(first.body);
    const conflict = await postRegistration({ ...body, fullName: 'اسم مختلف' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await Enrollment.countDocuments()).toBe(1);
  });

  it('returns the existing neutral confirmation for duplicate active registrations and creates no second enrollment', async () => {
    await createCourse();
    const body = validBody({ email: 'duplicate-active@example.test', idempotencyKey: 'duplicate-key-first-001' });
    const first = await postRegistration(body).expect(201);
    const duplicate = await postRegistration({ ...body, idempotencyKey: 'duplicate-key-second-002' }).expect(200);
    expect(duplicate.body).toEqual(first.body);
    expect(await Enrollment.countDocuments()).toBe(1);
    expect(Object.keys(duplicate.body).sort()).toEqual(['reference', 'status']);
  });

  it('serializes concurrent duplicate submissions into one active enrollment', async () => {
    await createCourse();
    const base = validBody({ email: 'concurrent@example.test' });
    const results = await Promise.all([
      postRegistration({ ...base, idempotencyKey: 'concurrent-submit-one-0001' }),
      postRegistration({ ...base, idempotencyKey: 'concurrent-submit-two-0002' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(results[0]?.body.reference).toBe(results[1]?.body.reference);
    expect(await Enrollment.countDocuments()).toBe(1);
  });

  it('allows a second course on the same lead, preserves first-touch attribution and only links same-phone leads as possible duplicates', async () => {
    await createCourse({ slug: 'registration-course' });
    await createCourse({ slug: 'second-course', title: 'كورس تاني' });
    const firstBody = validBody({ email: 'multi-course@example.test', attribution: { utm_source: 'first', utm_medium: 'social' } });
    await postRegistration(firstBody).expect(201);
    await postRegistration(validBody({ courseSlug: 'second-course', email: firstBody.email, attribution: { utm_source: 'second' } })).expect(201);
    const firstLead = await Lead.findOne({ email: firstBody.email }).lean();
    expect(await Lead.countDocuments({ email: firstBody.email })).toBe(1);
    expect(firstLead?.attribution).toMatchObject({ source: 'first', medium: 'social' });
    expect(await Enrollment.countDocuments({ leadId: firstLead?._id })).toBe(2);
    await postRegistration(validBody({ email: 'same-phone-other-email@example.test' })).expect(201);
    const secondLead = await Lead.findOne({ email: 'same-phone-other-email@example.test' }).lean();
    expect(String(secondLead?.possibleDuplicateOf)).toBe(String(firstLead?._id));
    expect(await Lead.countDocuments({ phoneNormalized: '201012345678' })).toBe(2);
  });

  it('snapshots promo pricing and published course content at registration time', async () => {
    const course = await createCourse({ price: 12_000, promo: 9_500 });
    const response = await postRegistration(validBody({ email: 'snapshot@example.test' })).expect(201);
    await Course.collection.updateOne({ _id: course._id }, { $set: { 'published.details.title.ar': 'عنوان جديد', 'published.details.pricing.promo': null, 'published.details.pricing.price': 20_000 } });
    const enrollment = await Enrollment.findOne({ reference: response.body.reference }).lean();
    expect(enrollment?.courseSnapshot?.title?.ar).toBe('كورس تجريبي');
    expect(enrollment?.priceSnapshot?.amount).toBe(9_500);
  });

  it('confirmation returns only reference, Arabic course title and status; unknown references have the same 404', async () => {
    await createCourse();
    const body = validBody({ fullName: 'اسم سري', email: 'private-confirmation@example.test', phone: '01012345678' });
    const created = await postRegistration(body).expect(201);
    const known = await requestAgent().get(`/api/v1/public/registrations/${created.body.reference}`).expect(200);
    expect(known.body).toEqual({ reference: created.body.reference, courseTitle: { ar: 'كورس تجريبي' }, status: 'received' });
    expect(JSON.stringify(known.body)).not.toMatch(/اسم سري|private-confirmation|01012345678|leadId|courseId|_id/);
    const unknownOne = await requestAgent().get('/api/v1/public/registrations/PAS-ZZZZZZ');
    const unknownTwo = await requestAgent().get('/api/v1/public/registrations/PAS-AAAAAA');
    expect(unknownOne.status).toBe(404);
    expect(unknownTwo.status).toBe(404);
    expect(unknownOne.body.error).toMatchObject({ code: unknownTwo.body.error.code, message: unknownTwo.body.error.message });
    expect(Object.keys(unknownOne.body.error).sort()).toEqual(Object.keys(unknownTwo.body.error).sort());
  });

  it('enforces a burst limit per IP and a separate limit keyed by normalized email hash', async () => {
    const ipLimitedApp = request(createApp(environment, { logger, rateLimitMax: 500, publicRegistrationRateLimits: { perIp: 2, perEmailHash: 100 } }));
    for (let index = 0; index < 2; index += 1) {
      await postRegistration(validBody({ email: `ip-limit-${index}@example.test`, website: 'bot' }), ipLimitedApp).expect(200);
    }
    const ipBurst = await postRegistration(validBody({ email: 'ip-limit-last@example.test', website: 'bot' }), ipLimitedApp);
    expect(ipBurst.status).toBe(429);
    expect(ipBurst.body.error.code).toBe('RATE_LIMITED');

    const emailLimitedApp = request(createApp(environment, { logger, rateLimitMax: 500, publicRegistrationRateLimits: { perIp: 100, perEmailHash: 2 } }));
    const repeatedEmail = 'normalized-limit@example.test';
    await postRegistration(validBody({ email: repeatedEmail, website: 'bot' }), emailLimitedApp).expect(200);
    await postRegistration(validBody({ email: repeatedEmail.toUpperCase(), website: 'bot' }), emailLimitedApp).expect(200);
    const emailBurst = await postRegistration(validBody({ email: repeatedEmail, website: 'bot' }), emailLimitedApp);
    expect(emailBurst.status).toBe(429);
    expect(emailBurst.body.error.code).toBe('RATE_LIMITED');
  });

  it('keeps a registration successful when notification fan-out fails and logs no request PII', async () => {
    await createCourse();
    await createUser('notify-admin@example.test', 'admin');
    const errorSpy = vi.spyOn(logger, 'error');
    vi.spyOn(Notification, 'create').mockRejectedValue(new Error('contains-private@example.test and 01012345678'));
    const response = await postRegistration(validBody({ fullName: 'اسم خاص', email: 'private@example.test' })).expect(201);
    expect(response.body.status).toBe('received');
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/اسم خاص|private@example\.test|01012345678|contains-private/);
    const audit = await AuditLog.findOne({ action: 'registration_created' }).lean();
    expect(JSON.stringify(audit)).not.toMatch(/اسم خاص|private@example\.test|01012345678/);
  });

  it('requires an allowlisted Origin but does not require CSRF for public JSON registration', async () => {
    await createCourse();
    const body = validBody({ email: 'origin-check@example.test' });
    await requestAgent().post('/api/v1/public/registrations').send(body).expect(403);
    await requestAgent().post('/api/v1/public/registrations').set('Origin', 'https://untrusted.example').send(body).expect(403);
    await postRegistration(body).expect(201);
  });
});
