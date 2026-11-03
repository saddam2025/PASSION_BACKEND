import 'dotenv/config';
import mongoose from 'mongoose';
import { Lead } from '../src/models/Lead';
import { Enrollment } from '../src/models/Enrollment';
import { User } from '../src/models/User';
import { Notification } from '../src/models/Notification';
import { hashPassword } from '../src/services/passwords';

async function main() {
  const uri = process.env.MONGODB_URI_TEST;
  const adminEmail = process.env.BE5B_SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.BE5B_SMOKE_ADMIN_PASSWORD;
  const assistantEmail = process.env.BE5B_SMOKE_ASSISTANT_EMAIL;
  const assistantPassword = process.env.BE5B_SMOKE_ASSISTANT_PASSWORD;
  if (!uri || !adminEmail || !adminPassword || !assistantEmail || !assistantPassword) throw new Error('BE-5B HTTP smoke setup requires its test-only environment variables.');
  const databaseName = decodeURIComponent(new URL(uri).pathname.slice(1).split('/')[0] ?? '');
  if (!databaseName.endsWith('_test')) throw new Error('BE-5B HTTP smoke setup refuses a database not ending in _test.');
  await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 10_000 });
  try {
    const [admin, assistant] = await User.create([
      { email: adminEmail, name: 'مسؤول اختبار HTTP', role: 'admin', passwordHash: await hashPassword(adminPassword), permissions: {}, isActive: true },
      { email: assistantEmail, name: 'مساعد اختبار HTTP', role: 'assistant', passwordHash: await hashPassword(assistantPassword), permissions: {}, isActive: true },
    ]);
    const suffix = Date.now().toString(36).toUpperCase().slice(-6).replace(/[01IO]/g, '2');
    const lead = await Lead.create({ fullName: 'عميل اختبار HTTP', email: `be5b-${Date.now()}@example.test`, phone: '01012345678', phoneNormalized: `201012${Date.now().toString().slice(-6)}`, consent: { acceptedAt: new Date(), policyVersion: 1 }, attribution: {} });
    const enrollment = await Enrollment.create({
      reference: `PAS-${suffix.padEnd(6, '2')}`,
      leadId: lead._id,
      courseId: new mongoose.Types.ObjectId(),
      courseSnapshot: { title: { ar: 'كورس اختبار HTTP' }, slug: 'be5b-http-test' },
      priceSnapshot: { amount: 10_000, currency: 'EGP' },
      consent: { acceptedAt: new Date(), policyVersion: 1 }, formSnapshot: { fields: [] }, answers: {},
      enrollmentStatus: 'pending', followUpStatus: 'new', isActive: true, registeredAt: new Date(), idempotencyKey: `be5b-http-${Date.now()}`,
    });
    await Notification.create({ recipientId: admin!._id, type: 'new_registration', params: { reference: enrollment.reference }, entityType: 'enrollment', entityId: enrollment._id });
    process.stdout.write(JSON.stringify({ adminId: String(admin!._id), assistantId: String(assistant!._id), enrollmentId: String(enrollment._id) }));
  } finally { await mongoose.disconnect(); }
}
main().catch((error: unknown) => { process.stderr.write(`BE-5B HTTP smoke fixture setup failed (${error instanceof Error ? error.name : 'unknown error'}).\n`); process.exitCode = 1; });
