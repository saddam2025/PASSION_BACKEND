import 'dotenv/config';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Category, Course, Enrollment, Invite, Lead, Media, Note, Notification, PasswordReset, Payment, RefreshToken, AuditLog, Settings, User } from '../models';
import { voidConfirmedPayment } from '../models/paymentImmutability';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const uri = process.env.MONGODB_URI_TEST;
const allowSkip = process.env.ALLOW_SKIP_DB_TESTS === '1';
const describeDb = uri ? describe : describe.skip;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
const models = [Course, Enrollment, Invite, Lead, Media, Note, Notification, PasswordReset, Payment, RefreshToken, AuditLog, Settings, Category, User];
const ownedCollections = [...new Set(models.map((model) => model.collection.name))];
if (!uri) {
  if (!allowSkip) throw new Error('BE-2 MongoDB tests require MONGODB_URI_TEST. Set ALLOW_SKIP_DB_TESTS=1 only to explicitly skip database tests.');
  console.warn('[SKIPPED] BE-2 MongoDB model/index tests: MONGODB_URI_TEST is missing; explicitly allowed by ALLOW_SKIP_DB_TESTS=1.');
}
if (uri && process.env.NODE_ENV !== 'test') throw new Error('BE-2 MongoDB tests refuse to run unless NODE_ENV=test.');
if (!dbName.endsWith('_test')) throw new Error('BE-2 MongoDB tests require a database name ending in _test.');

beforeAll(async () => {
  if (!uri) return;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, ownedCollections);
}, 60_000);

afterAll(async () => {
  if (!uri || mongoose.connection.readyState !== 1) return;
  await clearNamedCollections(mongoose.connection, ownedCollections);
  await mongoose.disconnect();
});

const id = () => new mongoose.Types.ObjectId();
const leadInput = (email: string) => ({
  fullName: 'اختبار', email, phone: '+201000000000', phoneNormalized: '201000000000',
  consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: { source: 'test' },
});
const enrollmentInput = (leadId: mongoose.Types.ObjectId, courseId: mongoose.Types.ObjectId, suffix: string) => ({
  reference: `PAS-${suffix.replaceAll('1', '2').replaceAll('0', '3').padEnd(6, '2').slice(0, 6)}`,
  leadId, courseId, courseSnapshot: { title: { ar: 'كورس تجريبي' }, slug: 'course-test' },
  priceSnapshot: { amount: 10000, currency: 'EGP' }, consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: {},
  enrollmentStatus: 'pending' as const, followUpStatus: 'new' as const, registeredAt: new Date(), idempotencyKey: `enroll-${suffix}`,
});

describeDb('BE-2 MongoDB models and indexes', () => {
  it('cleans only its model collections in the configured _test database', async () => {
    expect(mongoose.connection.name).toBe(dbName);
    const sentinel = mongoose.connection.collection('be2_cleanup_sentinel');
    await sentinel.deleteMany({});
    await sentinel.insertOne({ marker: 'preserve' });
    await clearNamedCollections(mongoose.connection, ownedCollections);
    expect(await sentinel.countDocuments({ marker: 'preserve' })).toBe(1);
    await sentinel.deleteMany({});
  });
  it('builds unique, lookup, partial and TTL indexes before assertions', async () => {
    for (const model of models) await model.init();
    const inviteIndexes = await Invite.collection.indexes();
    const resetIndexes = await PasswordReset.collection.indexes();
    const refreshIndexes = await RefreshToken.collection.indexes();
    const enrollmentIndexes = await Enrollment.collection.indexes();
    const paymentIndexes = await Payment.collection.indexes();
    expect(inviteIndexes.some((index) => index.key.purgeAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(resetIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(refreshIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(enrollmentIndexes.some((index) => index.unique && index.key.leadId === 1 && index.partialFilterExpression?.isActive === true)).toBe(true);
    expect(enrollmentIndexes.some((index) => index.key['paymentSummary.status'] === 1)).toBe(true);
    expect(paymentIndexes.some((index) => index.unique && index.key.idempotencyKey === 1)).toBe(true);
    expect(paymentIndexes.some((index) => index.key.status === 1 && index.key.method === 1 && index.key.kind === 1 && index.key.receivedAt === -1)).toBe(true);
  });
  it('rejects duplicate unique email, token hash, slug, old slug, idempotency and slug-history ownership', async () => {
    const userBase = { email: 'unique@example.com', name: 'User', passwordHash: 'hash'.repeat(8), role: 'admin' as const };
    await User.create(userBase);
    await expect(User.create(userBase)).rejects.toMatchObject({ code: 11000 });
    const hash = 'a'.repeat(64);
    await Invite.create({ tokenHash: hash, email: 'invite@example.com', role: 'assistant', permissions: [], invitedBy: id(), expiresAt: new Date(Date.now() + 100000), purgeAt: new Date(Date.now() + 1000000) });
    await expect(Invite.create({ tokenHash: hash, email: 'other@example.com', role: 'assistant', invitedBy: id(), expiresAt: new Date(Date.now() + 100000), purgeAt: new Date(Date.now() + 1000000) })).rejects.toMatchObject({ code: 11000 });
    await PasswordReset.create({ tokenHash: 'b'.repeat(64), userId: id(), expiresAt: new Date(Date.now() + 100000) });
    await expect(PasswordReset.create({ tokenHash: 'b'.repeat(64), userId: id(), expiresAt: new Date(Date.now() + 100000) })).rejects.toMatchObject({ code: 11000 });
    await RefreshToken.create({ tokenHash: 'c'.repeat(64), userId: id(), familyId: 'family-one', expiresAt: new Date(Date.now() + 100000) });
    await expect(RefreshToken.create({ tokenHash: 'c'.repeat(64), userId: id(), familyId: 'family-two', expiresAt: new Date(Date.now() + 100000) })).rejects.toMatchObject({ code: 11000 });
    const author = id();
    const draft = { details: {}, page: { schemaVersion: 1, sections: [] }, form: {} };
    await Course.create({ slug: 'current-slug', slugHistory: ['legacy-slug'], createdBy: author, draft });
    await expect(Course.create({ slug: 'current-slug', createdBy: author, draft })).rejects.toMatchObject({ code: 11000 });
    await expect(Course.create({ slug: 'legacy-slug', createdBy: author, draft })).rejects.toMatchObject({ code: 11000 });
    await expect(Course.create({ slug: 'another-slug', slugHistory: ['legacy-slug'], createdBy: author, draft })).rejects.toMatchObject({ code: 11000 });
    const lead = await Lead.create(leadInput('enrollment@example.com'));
    const courseId = id();
    await Enrollment.create(enrollmentInput(lead._id, courseId, '111111'));
    await expect(Enrollment.create(enrollmentInput(lead._id, courseId, '222222'))).rejects.toMatchObject({ code: 11000 });
    await expect(Enrollment.create({ ...enrollmentInput(id(), courseId, '111111'), leadId: id(), reference: 'PAS-ABCDEF' })).rejects.toMatchObject({ code: 11000 });
    await Category.create({ name: { ar: 'تصنيف' }, slug: 'unique-category', order: 1 });
    await expect(Category.create({ name: { ar: 'تصنيف آخر' }, slug: 'unique-category', order: 2 })).rejects.toMatchObject({ code: 11000 });
    await Media.create({ key: 'media/2026/10/0123456789abcdef0123456789abcdef-original.webp', bucket: 'public', mime: 'image/webp', size: 10, uploadedBy: id(), variants: [{ name: 'original', key: 'media/2026/10/0123456789abcdef0123456789abcdef-original.webp', width: 10, height: 10, mime: 'image/webp' }] });
    await expect(Media.create({ key: 'media/2026/10/0123456789abcdef0123456789abcdef-original.webp', bucket: 'public', mime: 'image/webp', size: 10, uploadedBy: id(), variants: [{ name: 'original', key: 'media/2026/10/0123456789abcdef0123456789abcdef-original.webp', width: 10, height: 10, mime: 'image/webp' }] })).rejects.toMatchObject({ code: 11000 });
  });
  it('allows another lead/course enrollment once the previous registration is cancelled', async () => {
    const lead = await Lead.create(leadInput('cancelled@example.com'));
    const courseId = id();
    const first = await Enrollment.create(enrollmentInput(lead._id, courseId, '333333'));
    first.enrollmentStatus = 'cancelled';
    await first.save();
    const second = await Enrollment.create(enrollmentInput(lead._id, courseId, '444444'));
    expect(second.isActive).toBe(true);
  });
  it('persists modified Mixed course sections without revision history fields', async () => {
    const course = await Course.create({ slug: 'mixed-sections', createdBy: id(), draft: { details: {}, page: { schemaVersion: 1, sections: [{ id: 'one', title: 'before' }] }, form: {} } });
    const sections = course.draft.page?.sections;
    if (!sections?.length) throw new Error('Course test fixture has no sections');
    (sections[0] as { title: string }).title = 'after';
    course.markSectionContentModified();
    await course.save();
    const reloaded = await Course.findById(course._id);
    expect((reloaded?.draft.page?.sections[0] as { title: string }).title).toBe('after');
    expect(Course.schema.path('versions')).toBeUndefined();
    expect(Course.schema.path('review')).toBeUndefined();
  });
  it('blocks payment edits/deletes and allows one reasoned void only', async () => {
    const payment = await Payment.create({ enrollmentId: id(), kind: 'payment', amount: 500, currency: 'EGP', method: 'cash', receivedAt: new Date(), recordedBy: id(), confirmedBy: id(), idempotencyKey: 'payment-immutable' });
    await expect(Payment.create({ enrollmentId: id(), kind: 'payment', amount: 500, currency: 'EGP', method: 'cash', receivedAt: new Date(), recordedBy: id(), confirmedBy: id(), idempotencyKey: 'payment-immutable' })).rejects.toMatchObject({ code: 11000 });
    await expect(Payment.updateOne({ _id: payment._id }, { $set: { amount: 900 } })).rejects.toThrow(/immutable/);
    await expect(Payment.updateMany({ _id: payment._id }, { $set: { status: 'voided', voidReason: 'reason', voidedAt: new Date(), voidedBy: id() } })).rejects.toThrow(/updateMany/);
    await expect(Payment.deleteOne({ _id: payment._id })).rejects.toThrow(/cannot be deleted/);
    await expect(voidConfirmedPayment(payment._id, id(), '   ')).rejects.toThrow(/reason is required/i);
    await voidConfirmedPayment(payment._id, id(), 'تم تسجيل المبلغ بالخطأ');
    await expect(voidConfirmedPayment(payment._id, id(), 'سبب تاني')).rejects.toThrow(/voided once/);
  });
  it('keeps audit logs append-only', async () => {
    const entry = await AuditLog.create({ actorId: id(), action: 'test.append', entityType: 'course', entityId: id(), occurredAt: new Date() });
    await expect(AuditLog.updateOne({ _id: entry._id }, { $set: { note: 'changed' } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({ _id: entry._id })).rejects.toThrow(/append-only/);
  });
});
