import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { AuditLog } from '../models/AuditLog';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Notification } from '../models/Notification';
import { Payment } from '../models/Payment';
import { RefreshToken } from '../models/RefreshToken';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { toAuthActor } from '../services/authTokens';
import { hashPassword } from '../services/passwords';
import { paymentsService, recomputePaymentSummary } from '../services/paymentsService';
import { staffRecordsService } from '../services/staffRecordsService';
import { assertEnrollmentExportLimit, ENROLLMENT_EXPORT_MAX_ROWS, prepareEnrollmentExport } from '../services/enrollmentExportService';
import { cairoDayRange } from '../lib/time';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';
import type { AuthActor } from '../types/express';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-5C integration tests require MONGODB_URI_TEST; skipped tests are not accepted.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-5C integration tests require NODE_ENV=test.');
const environment = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: uri,
  ACCESS_TOKEN_SECRET: 'be5c-test-access-secret-long-enough-0001', REFRESH_TOKEN_SECRET: 'be5c-test-refresh-secret-long-enough-0002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});
const logger = createLogger('silent');
const origin = 'http://localhost:5173';
const adminPassword = 'AdminPassphrase7!';
const assistantPassword = 'AssistantPhrase8!';
const app = createApp(environment, { logger, rateLimitMax: 500 });
const owned = [AuditLog, Enrollment, Lead, Notification, Payment, RefreshToken, Settings].map((model) => model.collection.name);
const client = () => request.agent(app);
type Client = ReturnType<typeof client>;
async function login(target: Client, email = 'be5c-admin@example.test', password = adminPassword) {
  const csrf = await target.get('/api/v1/auth/csrf').expect(200);
  await target.post('/api/v1/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf.body.csrfToken).send({ email, password }).expect(200);
  return { target, csrf: csrf.body.csrfToken as string };
}
function post(session: { target: Client; csrf: string }, path: string, body: unknown) {
  return session.target.post(path).set('Origin', origin).set('X-CSRF-Token', session.csrf).send(body as object);
}
function paymentInput(overrides: Record<string, unknown> = {}) {
  return { kind: 'payment', amount: 5_000, currency: 'EGP', method: 'cash', receivedAt: '2026-10-31T12:00:00.000Z', idempotencyKey: `be5c-${crypto.randomUUID()}`, ...overrides };
}
async function createEnrollment(index: number, options: { price?: number | null; currency?: string; fullName?: string; courseId?: mongoose.Types.ObjectId } = {}) {
  const lead = await Lead.create({ fullName: options.fullName ?? `عميل دفعات ${index}`, email: `pay-${index}-${crypto.randomUUID()}@example.test`, phone: '01012345678', phoneNormalized: `201012${String(index).padStart(6, '0')}`, consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {} });
  const courseId = options.courseId ?? new mongoose.Types.ObjectId();
  const enrollment = await Enrollment.create({ reference: `PAS-${['A','B','C','D','E','F','G','H','J','K','L','M'][index % 12]}${['N','P','Q','R','S','T','U','V','W','X','Y','Z'][index % 12]}2345`, leadId: lead._id, courseId, courseSnapshot: { title: { ar: `كورس دفعات ${index}` }, slug: `payment-course-${index}` }, priceSnapshot: { amount: options.price === undefined ? 10_000 : options.price, currency: options.currency ?? 'EGP' }, audience: options.currency === 'USD' ? 'foreign' : 'egyptian', consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: {}, enrollmentStatus: 'pending', followUpStatus: 'new', isActive: true, registeredAt: new Date(), idempotencyKey: `enroll-payment-${index}-${crypto.randomUUID()}` });
  return { lead, enrollment };
}
async function expectSummary(enrollmentId: mongoose.Types.ObjectId, expected: string) {
  const stored = (await Enrollment.findById(enrollmentId).select('paymentSummary').lean())?.paymentSummary;
  const fresh = await recomputePaymentSummary(enrollmentId);
  expect(stored?.netMinor).toBe(fresh.netMinor);
  expect(stored?.currency ?? 'EGP').toBe(fresh.currency);
  expect(stored?.status).toBe(fresh.status);
  expect(stored?.lastPaymentAt?.toISOString() ?? null).toBe(fresh.lastPaymentAt?.toISOString() ?? null);
  expect(stored?.status).toBe(expected);
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, [...owned, User.collection.name]);
  await User.create([
    { email: 'be5c-admin@example.test', name: 'مسؤول الدفعات', role: 'admin', passwordHash: await hashPassword(adminPassword), permissions: {}, isActive: true },
    { email: 'be5c-assistant@example.test', name: 'مساعد بلا دفع', role: 'assistant', passwordHash: await hashPassword(assistantPassword), permissions: {}, isActive: true },
    { email: 'be5c-recorder@example.test', name: 'مساعد تسجيل الدفعات', role: 'assistant', passwordHash: await hashPassword(assistantPassword), permissions: { recordPayments: true }, isActive: true },
  ]);
}, 60_000);
afterEach(async () => { vi.restoreAllMocks(); await clearNamedCollections(mongoose.connection, owned); });
afterAll(async () => { if (mongoose.connection.readyState === 1) { await clearNamedCollections(mongoose.connection, [...owned, User.collection.name]); await mongoose.disconnect(); } });

describe('BE-5C payments, derived summaries and export (Atlas passion_test)', () => {
  it('records partial then full payment, replays idempotently, confirms without a reason when paid, and supports refunds', async () => {
    const { enrollment } = await createEnrollment(1);
    const assigned = (await User.findOne({ email: 'be5c-assistant@example.test' }))!;
    await Enrollment.updateOne({ _id: enrollment._id }, { $set: { assignedTo: assigned._id } });
    const admin = await login(client());
    const part = paymentInput({ amount: 4_000, idempotencyKey: 'be5c-replay-same-0001' });
    const first = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, part).expect(201);
    expect(first.body.paymentSummary).toMatchObject({ netMinor: 4_000, status: 'partially_paid', outstandingMinor: 6_000 });
    await expectSummary(enrollment._id, 'partially_paid');
    const notices = await Notification.find({ entityId: first.body.payment.id }).lean();
    expect(notices.map((notice) => String(notice.recipientId)).sort()).toEqual([String((await User.findOne({ role: 'admin' }))!._id), String(assigned._id)].sort());
    const notice = notices[0];
    const noticeParams = notice?.params instanceof Map ? Object.fromEntries(notice.params) : notice?.params;
    expect(Object.keys(noticeParams ?? {}).sort()).toEqual(['amount', 'reference']);
    expect(await Notification.countDocuments({ entityId: first.body.payment.id })).toBe(2);
    const replay = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, part).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, { ...part, amount: 3_000 }).expect(409);
    const rest = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ amount: 6_000 })).expect(201);
    expect(rest.body.paymentSummary).toMatchObject({ netMinor: 10_000, status: 'paid', outstandingMinor: 0 });
    await expectSummary(enrollment._id, 'paid');
    await post(admin, `/api/v1/enrollments/${enrollment._id}/confirm`, {}).expect(200);
    const partialRefund = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', amount: 2_000, note: 'استرداد جزئي', idempotencyKey: 'be5c-refund-partial-0001' })).expect(201);
    expect(partialRefund.body.paymentSummary).toMatchObject({ netMinor: 8_000, status: 'partially_refunded' });
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', amount: 8_001, note: 'مبلغ أكبر من المتاح', idempotencyKey: 'be5c-refund-over-net-0001' })).expect(409);
    const restRefund = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', amount: 8_000, note: 'استرداد الباقي', idempotencyKey: 'be5c-refund-rest-0001' })).expect(201);
    expect(restRefund.body.paymentSummary).toMatchObject({ netMinor: 0, status: 'refunded' });
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', amount: 1, note: 'استرداد بعد الصفر', idempotencyKey: 'be5c-refund-zero-net-0001' })).expect(409);
    await expectSummary(enrollment._id, 'refunded');
    expect(await Payment.countDocuments({ enrollmentId: enrollment._id })).toBe(4);
    expect(JSON.stringify(first.body)).not.toMatch(/payloadHash|passwordHash|tokenHash/);
    expect(await AuditLog.countDocuments({ entityType: 'payment' })).toBe(4);
    const auditText = JSON.stringify(await AuditLog.find({ entityType: 'payment' }).lean());
    expect(auditText).not.toMatch(/example\.test|01012345678|عميل دفعات/);
  }, 60_000);

  it('voids once with a reason, refuses a void that makes net negative, and recomputes the enrollment summary', async () => {
    const { enrollment } = await createEnrollment(2);
    const admin = await login(client());
    const one = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ amount: 5_000 })).expect(201);
    const two = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ amount: 5_000 })).expect(201);
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', amount: 6_000, note: 'استرداد جزئي', idempotencyKey: 'be5c-void-refund-0001' })).expect(201);
    await post(admin, `/api/v1/payments/${one.body.payment.id}/void`, { reason: 'إلغاء يسبب صافي سالب' }).expect(409);
    expect((await Payment.findById(one.body.payment.id).lean())?.status).toBe('confirmed');
    await expectSummary(enrollment._id, 'partially_refunded');
    const refund = await Payment.findOne({ enrollmentId: enrollment._id, kind: 'refund' }).lean();
    await post(admin, `/api/v1/payments/${refund!._id}/void`, { reason: 'إلغاء الاسترداد الخاطئ' }).expect(200);
    await expectSummary(enrollment._id, 'paid');
    await post(admin, `/api/v1/payments/${one.body.payment.id}/void`, { reason: 'إلغاء دفعة مكررة' }).expect(200);
    await expectSummary(enrollment._id, 'partially_paid');
    await post(admin, `/api/v1/payments/${one.body.payment.id}/void`, { reason: 'محاولة ثانية' }).expect(404);
    await post(admin, `/api/v1/payments/${two.body.payment.id}/void`, {}).expect(400);
    expect(await AuditLog.countDocuments({ action: 'payment_voided' })).toBe(2);
  }, 60_000);

  it('serializes concurrent identical payment submissions to one immutable record', async () => {
    const { enrollment } = await createEnrollment(3);
    const admin = await login(client());
    const body = paymentInput({ amount: 3_000, idempotencyKey: 'be5c-concurrent-identical-0001' });
    const results = await Promise.all([
      post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, body),
      post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, body),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.payment.id).toBe(results[1]!.body.payment.id);
    expect(await Payment.countDocuments({ enrollmentId: enrollment._id })).toBe(1);
    await expectSummary(enrollment._id, 'partially_paid');
  });

  it('rolls back the record when the denormalized summary update fails', async () => {
    const { enrollment } = await createEnrollment(4);
    const assistant = (await User.findOne({ email: 'be5c-recorder@example.test' }))!;
    const actor = toAuthActor(assistant);
    const updateSpy = vi.spyOn(Enrollment, 'updateOne').mockRejectedValueOnce(new Error('simulated summary failure'));
    await expect(paymentsService.record(String(enrollment._id), paymentInput({ idempotencyKey: 'be5c-summary-failure-0001' }) as never, actor, logger)).rejects.toThrow('simulated summary failure');
    updateSpy.mockRestore();
    expect(await Payment.countDocuments({ enrollmentId: enrollment._id })).toBe(0);
    await expectSummary(enrollment._id, 'unpaid');
  });

  it('enforces fixed Assistant payment rights, CSRF, ownership and currency matching', async () => {
    const { enrollment } = await createEnrollment(5);
    await request(app).get('/api/v1/payments').expect(401);
    const admin = await login(client());
    await admin.target.post(`/api/v1/enrollments/${enrollment._id}/payments`).set('Origin', origin).send(paymentInput()).expect(403);
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ currency: 'USD' })).expect(422);
    const defaultAssistant = await login(client(), 'be5c-assistant@example.test', assistantPassword);
    const defaultRecorded = await post(defaultAssistant, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput()).expect(201);
    await post(defaultAssistant, `/api/v1/payments/${defaultRecorded.body.payment.id}/void`, { reason: 'دفعة سجلتها بالخطأ' }).expect(200);
    const recorder = await login(client(), 'be5c-recorder@example.test', assistantPassword);
    const recorded = await post(recorder, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ idempotencyKey: 'be5c-recorder-own-payment-0001' })).expect(201);
    await post(recorder, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', note: 'طلب استرداد', idempotencyKey: 'be5c-assistant-refund-0001' })).expect(403);
    await post(recorder, `/api/v1/payments/${recorded.body.payment.id}/void`, { reason: 'إلغاء دفعة سجلتها بنفسي' }).expect(200);
    await post(recorder, `/api/v1/payments/${recorded.body.payment.id}/void`, { reason: 'محاولة إلغاء ثانية' }).expect(404);
    expect((await User.findOne({ email: 'be5c-recorder@example.test' }))?.role).toBe('assistant');
    expect((await Payment.findById(recorded.body.payment.id).lean())?.status).toBe('voided');
    const adminOwned = await createEnrollment(15);
    const adminPayment = await post(admin, `/api/v1/enrollments/${adminOwned.enrollment._id}/payments`, paymentInput({ idempotencyKey: 'be5c-admin-owned-payment-0001' })).expect(201);
    await post(recorder, `/api/v1/payments/${adminPayment.body.payment.id}/void`, { reason: 'محاولة إلغاء دفعة غيري' }).expect(403);
    const contactEnrollment = await createEnrollment(10, { price: null });
    await post(admin, `/api/v1/enrollments/${contactEnrollment.enrollment._id}/payments`, paymentInput({ currency: 'USD', amount: 1_000 })).expect(422);
    await Settings.create({ academyName: { ar: 'أكاديمية اختبار' }, defaultCurrency: 'EGP', enabledCurrencies: ['EGP', 'USD'] });
    const unknownPrice = await post(admin, `/api/v1/enrollments/${contactEnrollment.enrollment._id}/payments`, paymentInput({ currency: 'USD', amount: 1_000 })).expect(201);
    expect(unknownPrice.body.paymentSummary).toMatchObject({ netMinor: 1_000, status: 'pending', outstandingMinor: null });

    const overpaymentEnrollment = await createEnrollment(0, { price: 10_000 });
    const overpayment = await post(admin, `/api/v1/enrollments/${overpaymentEnrollment.enrollment._id}/payments`, paymentInput({ amount: 12_000 })).expect(201);
    expect(overpayment.body.paymentSummary).toMatchObject({ netMinor: 12_000, status: 'paid', outstandingMinor: 0 });
    await expectSummary(overpaymentEnrollment.enrollment._id, 'paid');
  });

  it('cancellation leaves payment records intact, derives cancelled, and still allows a refund', async () => {
    const { enrollment } = await createEnrollment(11);
    const admin = await login(client());
    const payment = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ amount: 5_000 })).expect(201);
    await post(admin, `/api/v1/enrollments/${enrollment._id}/cancel`, { reason: 'إلغاء بطلب العميل' }).expect(200);
    expect((await Payment.findById(payment.body.payment.id).lean())?.status).toBe('confirmed');
    await expectSummary(enrollment._id, 'cancelled');
    const refund = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', amount: 2_000, note: 'استرداد بعد الإلغاء', idempotencyKey: 'be5c-cancelled-refund-0001' })).expect(201);
    expect(refund.body.paymentSummary).toMatchObject({ netMinor: 3_000, status: 'cancelled' });
    await expectSummary(enrollment._id, 'cancelled');
  });

  it('keeps USD payment, refund, void bounds, and summaries in USD minor units', async () => {
    const { enrollment } = await createEnrollment(2, { price: 10_000, currency: 'USD' });
    const admin = await login(client());
    const mismatch = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ currency: 'EGP', amount: 10_000 })).expect(422);
    expect(mismatch.body.error.details).toContainEqual(expect.objectContaining({ field: 'currency' }));
    const payment = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ currency: 'USD', amount: 10_000, idempotencyKey: 'be5c-usd-payment-0001' })).expect(201);
    expect(payment.body.paymentSummary).toMatchObject({ netMinor: 10_000, currency: 'USD', status: 'paid', outstandingMinor: 0 });
    await expectSummary(enrollment._id, 'paid');
    const refund = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', currency: 'USD', amount: 3_000, idempotencyKey: 'be5c-usd-refund-0001' })).expect(201);
    expect(refund.body.paymentSummary).toMatchObject({ netMinor: 7_000, currency: 'USD', status: 'partially_refunded', outstandingMinor: 3_000 });
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ kind: 'refund', currency: 'USD', amount: 7_001, idempotencyKey: 'be5c-usd-refund-over-0001' })).expect(409);
    await post(admin, `/api/v1/payments/${payment.body.payment.id}/void`, { reason: 'إلغاء دفعة بالدولار' }).expect(409);
    await post(admin, `/api/v1/payments/${refund.body.payment.id}/void`, { reason: 'إلغاء استرداد بالدولار' }).expect(200);
    await expectSummary(enrollment._id, 'paid');
    expect((await recomputePaymentSummary(enrollment._id)).currency).toBe('USD');
    const currencyList = await admin.target.get('/api/v1/enrollments').expect(200);
    const listed = currencyList.body.items.find((item: { id: string }) => item.id === String(enrollment._id));
    expect(listed).toMatchObject({ id: String(enrollment._id), priceSnapshot: { currency: 'USD' }, paymentSummary: { currency: 'USD' } });
    expect(listed).not.toHaveProperty('audience');
    const detail = (await admin.target.get(`/api/v1/enrollments/${enrollment._id}`).expect(200)).body.enrollment;
    expect(detail).toMatchObject({ priceSnapshot: { currency: 'USD' }, paymentSummary: { currency: 'USD' } });
    expect(detail).not.toHaveProperty('audience');
    const csv = await admin.target.get('/api/v1/enrollments/export.csv').expect(200);
    expect(csv.text).toContain('العملة');
    expect(csv.text).not.toContain('الجمهور');
    expect(csv.text).toContain('USD');
    expect(csv.text).toContain('100.00');
  });

  it('filters and sorts enrollment/payment lists, hides summary for an actor without viewPayments, and scopes payment details', async () => {
    const courseId = new mongoose.Types.ObjectId();
    const first = await createEnrollment(6, { courseId });
    const second = await createEnrollment(7, { courseId });
    const admin = await login(client());
    await post(admin, `/api/v1/enrollments/${first.enrollment._id}/payments`, paymentInput({ amount: 10_000 })).expect(201);
    const unpaid = await admin.target.get('/api/v1/enrollments?paymentStatus=unpaid&sort=paymentStatus').expect(200);
    expect(unpaid.body.items.map((item: { id: string }) => item.id)).toContain(String(second.enrollment._id));
    expect(unpaid.body.items.map((item: { id: string }) => item.id)).not.toContain(String(first.enrollment._id));
    const paid = await admin.target.get('/api/v1/enrollments?paymentStatus=paid&sort=paymentStatus').expect(200);
    expect(paid.body.items[0]).toMatchObject({ id: String(first.enrollment._id), paymentSummary: { status: 'paid', netMinor: 10_000 } });
    const storedPayment = await Payment.findOne({ enrollmentId: first.enrollment._id, kind: 'payment' }).select('receivedAt').lean();
    const dayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(storedPayment!.receivedAt);
    const dayValues = Object.fromEntries(dayParts.map(({ type, value }) => [type, value]));
    const day = `${dayValues.year}-${dayValues.month}-${dayValues.day}`;
    const ledgerQuery = { courseId: String(courseId), kind: 'payment', status: 'confirmed', method: 'cash', dateFrom: day, dateTo: day };
    process.stdout.write(`BE-5C payment date diagnostic ${JSON.stringify({ storedReceivedAt: storedPayment!.receivedAt.toISOString(), computedRange: cairoDayRange(day, day), query: ledgerQuery, dateField: 'receivedAt', courseFilterJoin: 'enrollment.courseId' })}\n`);
    const ledger = await admin.target.get(`/api/v1/payments?courseId=${courseId}&kind=payment&status=confirmed&method=cash&dateFrom=${day}&dateTo=${day}`).expect(200);
    expect(ledger.body.total).toBe(1);
    expect(ledger.body.items[0].enrollment.reference).toBe(first.enrollment.reference);
    const details = await admin.target.get(`/api/v1/enrollments/${first.enrollment._id}/payments`).expect(200);
    expect(details.body).toMatchObject({ total: 1, paymentSummary: { netMinor: 10_000, status: 'paid', outstandingMinor: 0 } });
    const restrictedActor: AuthActor = { id: String((await User.findOne({ role: 'assistant' }))!._id), name: { ar: 'مساعد' }, email: 'restricted@example.test', role: 'assistant', permissions: ['viewLeads'] };
    const unprivilegedList = await staffRecordsService.listEnrollments({ sort: 'newest', page: 1, pageSize: 25 }, restrictedActor);
    expect(unprivilegedList.items[0]).not.toHaveProperty('paymentSummary');
    await expect(staffRecordsService.listEnrollments({ sort: 'paymentStatus', page: 1, pageSize: 25 }, restrictedActor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('filters payment ledger on inclusive Cairo-day boundaries across UTC date changes and returns an empty day', async () => {
    const courseId = new mongoose.Types.ObjectId();
    const { enrollment } = await createEnrollment(9, { courseId });
    const adminUser = (await User.findOne({ role: 'admin' }))!;
    const receivedAt = [
      new Date('2026-10-31T22:00:00.000Z'), // 00:00 Cairo, inclusive start
      new Date('2026-10-31T22:30:00.000Z'), // 00:30 Cairo on Nov 1; UTC date is Oct 31
      new Date('2026-11-01T21:30:00.000Z'), // 23:30 Cairo on Nov 1
      new Date('2026-11-01T21:59:59.999Z'), // inclusive end
    ];
    await Payment.create(receivedAt.map((date, index) => ({
      enrollmentId: enrollment._id, kind: 'payment', amount: 1, currency: 'EGP', method: 'cash', receivedAt: date,
      status: 'confirmed', recordedBy: adminUser._id, confirmedBy: adminUser._id, idempotencyKey: `be5c-cairo-boundary-${index}-0001`,
    })));
    const admin = await login(client());
    const day = await admin.target.get(`/api/v1/payments?courseId=${courseId}&dateFrom=2026-11-01&dateTo=2026-11-01`).expect(200);
    expect(day.body.total).toBe(4);
    expect(day.body.items.map((item: { receivedAt: string }) => new Date(item.receivedAt).toISOString()).sort()).toEqual(receivedAt.map((date) => date.toISOString()).sort());
    const empty = await admin.target.get(`/api/v1/payments?courseId=${courseId}&dateFrom=2026-11-02&dateTo=2026-11-02`).expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 0 });
  });

  it('streams safe Arabic CSV with BOM, matching filters, conditional payment columns, row cap, and a PII-free audit', async () => {
    const { lead, enrollment } = await createEnrollment(8, { fullName: ' =SUM(1,2)' });
    lead.email = 'csv-marker@example.test'; await lead.save();
    const admin = await login(client());
    await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput({ amount: 3_000 })).expect(201);
    const listed = await admin.target.get('/api/v1/enrollments?search=csv-marker').expect(200);
    const csv = await admin.target.get('/api/v1/enrollments/export.csv?search=csv-marker').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="registrations-\d{8}\.csv"$/);
    expect(csv.text.startsWith('\uFEFF')).toBe(true);
    expect(csv.text).toContain('"\'=SUM(1,2)"');
    expect(csv.text).toContain('حالة الدفع');
    expect(csv.text).not.toContain('الجمهور');
    expect(csv.text).not.toMatch(/_id|payloadHash|tokenHash|idempotencyKey/);
    expect(csv.text.split('\r\n').filter(Boolean).length - 1).toBe(listed.body.total);
    expect(csv.text).toContain('30.00');
    const audit = await AuditLog.findOne({ action: 'enrollments_exported' }).lean();
    expect(audit?.note).toContain('rowCount');
    expect(audit?.note).not.toMatch(/csv-marker|SUM\(1,2\)|01012345678/);
    expect(() => assertEnrollmentExportLimit(ENROLLMENT_EXPORT_MAX_ROWS + 1)).toThrow(/الحد الأقصى/);
    const exportOnlyActor: AuthActor = { ...toAuthActor((await User.findOne({ role: 'assistant' }))!), permissions: ['viewLeads', 'exportCsv'] };
    const restricted = await prepareEnrollmentExport({ search: 'csv-marker', sort: 'newest', page: 1, pageSize: 25 }, exportOnlyActor);
    expect(restricted.includePayments).toBe(false);
    await restricted.cursor.next();
    await restricted.cursor.close();
    const assistantWithoutExport = await login(client(), 'be5c-assistant@example.test', assistantPassword);
    await assistantWithoutExport.target.get('/api/v1/enrollments/export.csv').expect(403);
    await request(app).get('/api/v1/enrollments/export.csv').expect(401);
  });

  it('does not fail a payment request when notification delivery fails', async () => {
    const { enrollment } = await createEnrollment(9);
    const admin = await login(client());
    vi.spyOn(Notification, 'create').mockRejectedValueOnce(new Error('simulated notification outage'));
    const response = await post(admin, `/api/v1/enrollments/${enrollment._id}/payments`, paymentInput()).expect(201);
    expect(response.body.payment.kind).toBe('payment');
    expect(await Payment.countDocuments({ enrollmentId: enrollment._id })).toBe(1);
  });
});
