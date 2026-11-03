import { createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { withTransaction } from '../lib/withTransaction';
import { generateEnrollmentReference } from '../lib/enrollmentReference';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Notification } from '../models/Notification';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import type { PublicRegistrationBody } from '../shared/schemas/publicRegistration';
import { rolePermissionDefaults } from '../shared/schemas/permissions';
import { SYSTEM_ACTOR_ID } from './authTokens';
import { writeAudit } from './audit';
import { assertRegistrationOpen, getPublishedForRegistration, tx } from './publicCourseRegistration';

const POLICY_VERSION_DEFAULT = 1;
const CORE_ANSWER_KEYS = new Set(['fullName', 'email', 'phone', 'consent']);
const invalidSubmission = 'راجع بيانات التسجيل وحاول تاني.';

type RegistrationResult = { reference: string; status: 'received'; created: boolean; enrollmentId?: mongoose.Types.ObjectId };
type RegistrationField = { id: string; type: string; label: unknown; required?: boolean; maxLength?: number; options?: Array<{ value: string }> };

function badAnswer(details: Array<{ fieldId: string; reason: string }>): never {
  throw new ValidationError('راجع بيانات التسجيل وحاول تاني.', details);
}

function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex -- Strip control characters before visitor content is stored.
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/<[^>]*>/g, '').trim();
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (value.trim().startsWith('00')) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) return `20${digits.slice(1)}`;
  if (digits.startsWith('20')) return digits;
  if (value.trim().startsWith('+')) return digits;
  if (digits.startsWith('0')) digits = digits.slice(1);
  return `20${digits}`;
}

function plausiblePhone(value: string): boolean {
  return /^\d{8,15}$/.test(value);
}

function answerObject(body: PublicRegistrationBody): Record<string, string | boolean> {
  const normalized = { ...(body.answers as Record<string, string | boolean>) };
  for (const key of ['fullName', 'email', 'phone', 'consent'] as const) {
    const direct = body[key];
    const legacy = normalized[key];
    if (direct !== undefined && legacy !== undefined && direct !== legacy) {
      badAnswer([{ fieldId: key, reason: 'القيمة مكررة بشكل غير متطابق.' }]);
    }
    if (direct !== undefined) normalized[key] = direct;
  }
  return normalized;
}

function coreValue(body: PublicRegistrationBody, answers: Record<string, string | boolean>, key: 'fullName' | 'email' | 'phone'): string {
  const value = answers[key];
  if (typeof value !== 'string') badAnswer([{ fieldId: key, reason: 'الحقل ده مطلوب.' }]);
  return cleanText(value);
}

function dateMillis(value: number | string | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isAutomatedSubmission(body: PublicRegistrationBody): boolean {
  if ((body.website ?? body.honeypot ?? '').trim()) return true;
  const startedAt = dateMillis(body.formStartedAt ?? body.renderedAt);
  if (startedAt === null) return true;
  const elapsed = Date.now() - startedAt;
  return elapsed < 2_000 || startedAt > Date.now() + 60_000;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function requestFingerprint(body: PublicRegistrationBody, values: { fullName: string; email: string; phone: string; phoneNormalized: string; customAnswers: Record<string, string | boolean> }, secret: string): string {
  const attribution = normalizeAttribution(body.attribution);
  const submittedAnswers = Object.fromEntries(Object.entries(answerObject(body)).filter(([key]) => !CORE_ANSWER_KEYS.has(key)));
  const normalized = {
    courseSlug: body.courseSlug,
    fullName: values.fullName,
    email: values.email,
    phone: values.phone,
    phoneNormalized: values.phoneNormalized,
    answers: Object.keys(submittedAnswers).length ? values.customAnswers : {},
    consent: true,
    attribution,
  };
  return createHmac('sha256', secret).update(canonical(normalized)).digest('hex');
}

function normalizeAttribution(input: PublicRegistrationBody['attribution']): { source?: string; medium?: string; campaign?: string; referrer?: string; referrerPath?: string } {
  if (!input) return {};
  let referrer: string | undefined;
  let referrerPath: string | undefined;
  if (input.referrer) {
    try {
      const url = new URL(input.referrer);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        referrer = `${url.origin}${url.pathname}`.slice(0, 2_000);
        referrerPath = url.pathname.slice(0, 1_000);
      }
    } catch { /* Invalid referrers are omitted. */ }
  }
  return {
    ...(input.utm_source ? { source: cleanText(input.utm_source).slice(0, 200) } : {}),
    ...(input.utm_medium ? { medium: cleanText(input.utm_medium).slice(0, 200) } : {}),
    ...(input.utm_campaign ? { campaign: cleanText(input.utm_campaign).slice(0, 200) } : {}),
    ...(referrer ? { referrer } : {}),
    ...(referrerPath ? { referrerPath } : {}),
  };
}

function publishedFields(form: unknown): RegistrationField[] {
  if (!form || typeof form !== 'object' || !('fields' in form) || !Array.isArray(form.fields) || form.fields.length > 12) {
    throw new AppError('COURSE_NOT_AVAILABLE', 'نموذج التسجيل في الكورس ده غير جاهز.', 409);
  }
  const fields = form.fields as RegistrationField[];
  const ids = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field.id !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(field.id) || CORE_ANSWER_KEYS.has(field.id) || ids.has(field.id)) {
      throw new AppError('COURSE_NOT_AVAILABLE', 'نموذج التسجيل في الكورس ده غير جاهز.', 409);
    }
    ids.add(field.id);
    if (!['text', 'email', 'phone', 'select', 'radio', 'checkbox', 'textarea'].includes(field.type)) {
      throw new AppError('COURSE_NOT_AVAILABLE', 'نموذج التسجيل في الكورس ده غير جاهز.', 409);
    }
  }
  return fields;
}

function validateFormAnswers(fields: RegistrationField[], answers: Record<string, string | boolean>): Record<string, string | boolean> {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const errors: Array<{ fieldId: string; reason: string }> = [];
  for (const key of Object.keys(answers)) {
    if (!CORE_ANSWER_KEYS.has(key) && !fieldMap.has(key)) errors.push({ fieldId: key, reason: 'الحقل ده مش موجود في نموذج التسجيل.' });
  }
  const result: Record<string, string | boolean> = {};
  for (const field of fields) {
    const raw = answers[field.id];
    const limit = field.maxLength ?? (field.type === 'textarea' ? 4_000 : 300);
    if (raw === undefined || raw === '') {
      if (field.required) errors.push({ fieldId: field.id, reason: 'الحقل ده مطلوب.' });
      continue;
    }
    if (field.type === 'checkbox') {
      if (typeof raw !== 'boolean' || (field.required && raw !== true)) errors.push({ fieldId: field.id, reason: 'اختار قيمة صالحة للحقل ده.' });
      else result[field.id] = raw;
      continue;
    }
    if (typeof raw !== 'string') {
      errors.push({ fieldId: field.id, reason: 'اكتب قيمة نصية صالحة للحقل ده.' });
      continue;
    }
    const value = cleanText(raw);
    if (field.required && !value) errors.push({ fieldId: field.id, reason: 'الحقل ده مطلوب.' });
    if (value.length > limit) errors.push({ fieldId: field.id, reason: 'القيمة أطول من الحد المسموح.' });
    if ((field.type === 'select' || field.type === 'radio') && !field.options?.some((option) => option.value === value)) {
      errors.push({ fieldId: field.id, reason: 'اختار قيمة من الاختيارات المتاحة.' });
    }
    if (field.type === 'email' && value && !zodEmail(value)) errors.push({ fieldId: field.id, reason: 'اكتب بريد إلكتروني صحيح.' });
    if (field.type === 'phone' && value && !plausiblePhone(normalizePhone(value))) errors.push({ fieldId: field.id, reason: 'اكتب رقم تليفون صحيح.' });
    if (value !== '') result[field.id] = field.type === 'email' ? value.toLowerCase() : field.type === 'phone' ? `+${normalizePhone(value)}` : value;
  }
  if (errors.length) badAnswer(errors);
  return result;
}

function zodEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function courseTitleFrom(course: Awaited<ReturnType<typeof getPublishedForRegistration>>): { ar: string } {
  const details = course.published?.details ?? {};
  const title = tx(details.title);
  if (!title.trim()) throw new AppError('COURSE_NOT_AVAILABLE', 'الكورس ده مش متاح للتسجيل دلوقتي.', 404);
  return { ar: title };
}

function priceSnapshot(course: Awaited<ReturnType<typeof getPublishedForRegistration>>): { amount: number | null; currency: string } {
  const pricing = (course.published?.details?.pricing ?? {}) as Record<string, unknown>;
  const promo = pricing.promo ?? pricing.promoPrice;
  const price = pricing.price;
  const amount = typeof promo === 'number' ? promo : typeof price === 'number' ? price : null;
  return { amount: Number.isInteger(amount) && amount !== null && amount >= 0 ? amount : null, currency: typeof pricing.currency === 'string' ? pricing.currency.toUpperCase() : 'EGP' };
}

async function consentPolicyVersion(): Promise<number> {
  const settings = await Settings.findOne({ key: 'academy' }).lean();
  const pages = settings?.legalPages as unknown as Map<string, { policyVersion?: number }> | Record<string, { policyVersion?: number }> | undefined;
  const privacy = pages instanceof Map ? pages.get('privacy') : pages?.privacy;
  return Number.isInteger(privacy?.policyVersion) && (privacy?.policyVersion ?? -1) >= 0 ? privacy!.policyVersion! : POLICY_VERSION_DEFAULT;
}

async function matchingIdempotency(key: string, fingerprint: string): Promise<RegistrationResult | null> {
  const previous = await Enrollment.findOne({ idempotencyKey: key }).select('+idempotencyHash').lean();
  if (!previous) return null;
  if (previous.idempotencyHash !== fingerprint) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', 'مفتاح الطلب مستخدم لبيانات تسجيل مختلفة. ابدأ طلب جديد وحاول تاني.', 409);
  }
  return { reference: previous.reference, status: 'received', created: false };
}

function neutralResponse(): RegistrationResult {
  return { reference: generateEnrollmentReference(), status: 'received', created: false };
}

export async function submitPublicRegistration(body: PublicRegistrationBody, environment: AppEnvironment, logger: pino.Logger): Promise<RegistrationResult> {
  const sourceAnswers = answerObject(body);
  const fullName = coreValue(body, sourceAnswers, 'fullName');
  const email = coreValue(body, sourceAnswers, 'email').toLowerCase();
  const phone = coreValue(body, sourceAnswers, 'phone');
  const consent = body.consent ?? sourceAnswers.consent;
  if (consent !== true) badAnswer([{ fieldId: 'consent', reason: 'الموافقة مطلوبة لإكمال التسجيل.' }]);
  const emailOk = zodEmail(email) && email.length <= 254;
  const phoneNormalized = normalizePhone(phone);
  if (fullName.length < 2 || fullName.length > 120 || !emailOk || phone.length < 7 || phone.length > 32 || !plausiblePhone(phoneNormalized)) {
    badAnswer([{ fieldId: !emailOk ? 'email' : !plausiblePhone(phoneNormalized) ? 'phone' : 'fullName', reason: invalidSubmission }]);
  }

  const courseAnswers = Object.fromEntries(Object.entries(sourceAnswers).filter(([key]) => !CORE_ANSWER_KEYS.has(key)));
  const baseValues = { fullName, email, phone, phoneNormalized, customAnswers: courseAnswers };
  const fingerprint = requestFingerprint(body, baseValues, environment.ACCESS_TOKEN_SECRET);
  const replay = await matchingIdempotency(body.idempotencyKey, fingerprint);
  if (replay) return replay;
  if (isAutomatedSubmission(body)) return neutralResponse();

  const course = await getPublishedForRegistration(body.courseSlug);
  await assertRegistrationOpen(course);
  const details = course.published?.details ?? {};
  const title = courseTitleFrom(course);
  const fields = publishedFields(course.published?.form);
  const customAnswers = validateFormAnswers(fields, courseAnswers);
  const finalFingerprint = fingerprint;
  const now = new Date();
  const policyVersion = await consentPolicyVersion();
  const formSnapshot = { fields: fields.map((field) => ({ id: field.id, label: { ar: tx(field.label) }, type: field.type })) };
  const answers = { fullName, email, phone, ...customAnswers };
  const snapshotPrice = priceSnapshot(course);
  const enrollmentConfig = details.enrollment as Record<string, unknown> | undefined;

  let outcome: RegistrationResult | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      outcome = await withTransaction(async (session) => {
        const sameKey = await Enrollment.findOne({ idempotencyKey: body.idempotencyKey }).select('+idempotencyHash').session(session).lean();
        if (sameKey) {
          if (sameKey.idempotencyHash !== finalFingerprint) throw new AppError('IDEMPOTENCY_KEY_REUSED', 'مفتاح الطلب مستخدم لبيانات تسجيل مختلفة. ابدأ طلب جديد وحاول تاني.', 409);
          return { reference: sameKey.reference, status: 'received' as const, created: false };
        }

        let lead = await Lead.findOne({ email }).session(session);
        if (!lead) {
          const possibleDuplicate = await Lead.findOne({ phoneNormalized }).select('_id').session(session).lean();
          lead = new Lead({
            fullName, email, phone, phoneNormalized,
            consent: { acceptedAt: now, policyVersion },
            attribution: normalizeAttribution(body.attribution),
            ...(possibleDuplicate ? { possibleDuplicateOf: possibleDuplicate._id } : {}),
          });
          await lead.save({ session });
        }

        const active = await Enrollment.findOne({ leadId: lead._id, courseId: course._id, enrollmentStatus: { $in: ['pending', 'confirmed'] }, isActive: true }).session(session).lean();
        if (active) return { reference: active.reference, status: 'received' as const, created: false };

        if (typeof enrollmentConfig?.capacity === 'number' && Number.isInteger(enrollmentConfig.capacity) && enrollmentConfig.capacity >= 0) {
          const activeCount = await Enrollment.countDocuments({ courseId: course._id, isActive: true }).session(session);
          if (activeCount >= enrollmentConfig.capacity) throw new AppError('COURSE_FULL', 'الأماكن المتاحة في الكورس اكتملت.', 409);
        }

        let reference = generateEnrollmentReference();
        for (let check = 0; check < 8 && await Enrollment.exists({ reference }).session(session); check += 1) reference = generateEnrollmentReference();
        const enrollment = new Enrollment({
          reference,
          leadId: lead._id,
          courseId: course._id,
          courseSnapshot: { title, slug: course.slug },
          priceSnapshot: snapshotPrice,
          consent: { acceptedAt: now, policyVersion },
          formSnapshot,
          answers,
          enrollmentStatus: 'pending',
          followUpStatus: 'new',
          isActive: true,
          registeredAt: now,
          idempotencyKey: body.idempotencyKey,
          idempotencyHash: finalFingerprint,
          history: [{ at: now, to: 'pending', note: 'تسجيل عام', by: new mongoose.Types.ObjectId(SYSTEM_ACTOR_ID) }],
        });
        await enrollment.save({ session });
        return { reference, status: 'received' as const, created: true, enrollmentId: enrollment._id };
      });
      break;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      const sameKey = await matchingIdempotency(body.idempotencyKey, finalFingerprint);
      if (sameKey) return sameKey;
      const lead = await Lead.findOne({ email }).select('_id').lean();
      if (lead) {
        const duplicate = await Enrollment.findOne({ leadId: lead._id, courseId: course._id, isActive: true, enrollmentStatus: { $in: ['pending', 'confirmed'] } }).lean();
        if (duplicate) return { reference: duplicate.reference, status: 'received', created: false };
      }
      if (attempt === 1) throw new ConflictError('تعذر إكمال التسجيل دلوقتي. ابدأ طلب جديد وحاول تاني.');
    }
  }

  if (!outcome) throw new AppError('REGISTRATION_FAILED', 'تعذر إكمال التسجيل دلوقتي. حاول تاني.', 503);
  if (!outcome.created || !outcome.enrollmentId) return outcome;

  await writeAudit({ actorId: SYSTEM_ACTOR_ID, action: 'registration_created', entityType: 'enrollment', entityId: String(outcome.enrollmentId), afterStatus: 'pending' }, logger);
  await fanOutRegistrationNotifications(outcome.enrollmentId, title.ar, outcome.reference, logger);
  return outcome;
}

async function fanOutRegistrationNotifications(enrollmentId: mongoose.Types.ObjectId, courseTitle: string, reference: string, logger: pino.Logger): Promise<void> {
  try {
    const recipients = await User.find({ isActive: true, role: { $in: ['admin', 'assistant'] } }).select('_id role permissions').lean();
    const recipientsWithLeadAccess = recipients.filter((user) => user.role === 'admin' || user.permissions?.viewLeads === true || rolePermissionDefaults.assistant.includes('viewLeads'));
    await Promise.all(recipientsWithLeadAccess.map(async (recipient) => {
      try {
        await Notification.create({
          recipientId: recipient._id,
          type: 'new_registration',
          params: { courseTitle, reference },
          entityType: 'enrollment',
          entityId: enrollmentId,
          readAt: null,
        });
      } catch (error) {
        logger.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError', notificationType: 'new_registration' }, 'Registration notification could not be created');
      }
    }));
  } catch (error) {
    logger.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError', notificationType: 'new_registration' }, 'Registration notification fan-out failed');
  }
}

export async function getPublicRegistrationConfirmation(reference: string): Promise<{ reference: string; courseTitle: { ar: string }; status: 'received' }> {
  const enrollment = await Enrollment.findOne({ reference }).select('reference courseSnapshot.title').lean();
  if (!enrollment) throw new NotFoundError('الطلب ده مش موجود.');
  return { reference: enrollment.reference, courseTitle: { ar: tx(enrollment.courseSnapshot?.title) }, status: 'received' };
}

export const publicRegistrationInternals = { normalizePhone, cleanText, normalizeAttribution, isAutomatedSubmission, requestFingerprint };
