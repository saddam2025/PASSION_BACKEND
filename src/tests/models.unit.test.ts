import { describe, expect, it } from 'vitest';
import { Course } from '../models/Course';
import { Invite } from '../models/Invite';
import { Lead } from '../models/Lead';
import { Enrollment } from '../models/Enrollment';
import { Category } from '../models/Category';
import { Media } from '../models/Media';
import { PasswordReset } from '../models/PasswordReset';
import { Payment } from '../models/Payment';
import { RefreshToken } from '../models/RefreshToken';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { generateEnrollmentReference, generateUniqueEnrollmentReference } from '../lib/enrollmentReference';
import { getInviteStatus } from '../models/inviteStatus';

describe('BE-2 model validation and helpers', () => {
  it('requires user fields and restricts roles', () => {
    expect(new User({}).validateSync()?.errors.email).toBeDefined();
    expect(new User({ email: 'user@example.com', name: 'User', passwordHash: 'x'.repeat(30), role: 'owner' }).validateSync()?.errors.role).toBeDefined();
  });
  it('rejects raw token fields and strips credentials from JSON', () => {
    expect(() => new Invite({ rawToken: 'raw-secret' })).toThrow();
    const user = new User({ email: 'user@example.com', name: 'User', passwordHash: 'x'.repeat(30), role: 'assistant' });
    user.set('token', 'raw-secret', { strict: false });
    expect(user.toJSON()).not.toHaveProperty('passwordHash');
    expect(user.toJSON()).not.toHaveProperty('token');
    expect(user.toObject()).not.toHaveProperty('passwordHash');
  });
  it('validates payment amount, method and stored status fields', () => {
    const payment = new Payment({ amount: 1.5, currency: 'EGP', method: 'cheque', status: 'paid' });
    expect(payment.validateSync()?.errors.amount).toBeDefined();
    expect(payment.validateSync()?.errors.method).toBeDefined();
    expect(payment.validateSync()?.errors.status).toBeDefined();
    expect(Payment.schema.path('paymentStatus')).toBeUndefined();
  });
  it('validates required lead, enrollment, category and settings fields and enum boundaries', () => {
    expect(new Lead({}).validateSync()?.errors.email).toBeDefined();
    expect(new Enrollment({}).validateSync()?.errors.reference).toBeDefined();
    expect(new Category({ name: { ar: 'تصنيف' }, slug: 'غير صالح', order: 0 }).validateSync()?.errors.slug).toBeDefined();
    expect(new Settings({ key: 'academy', academyName: { ar: 'الأكاديمية' }, defaultCurrency: 'XYZ' }).validateSync()?.errors.defaultCurrency).toBeDefined();
    expect(new Media({ key: '/private/file.png', bucket: 'private', mime: 'image/png', size: 1, uploadedBy: '000000000000000000000001' }).validateSync()?.errors.key).toBeDefined();
  });
  it('requires lowercase SHA-256 token hashes and never accepts raw-token properties', () => {
    expect(new Invite({ tokenHash: 'raw-token' }).validateSync()?.errors.tokenHash).toBeDefined();
    expect(new PasswordReset({ tokenHash: 'raw-token' }).validateSync()?.errors.tokenHash).toBeDefined();
    expect(new RefreshToken({ tokenHash: 'raw-token' }).validateSync()?.errors.tokenHash).toBeDefined();
    expect(() => new PasswordReset({ rawToken: 'secret' })).toThrow();
    expect(() => new RefreshToken({ token: 'secret' })).toThrow();
  });
  it('retains invite status as a derived value and computes the thirty-day purge date', async () => {
    const expiresAt = new Date('2026-11-01T12:00:00Z');
    const invite = new Invite({ tokenHash: 'd'.repeat(64), email: 'invite@example.com', role: 'assistant', invitedBy: '000000000000000000000001', expiresAt, purgeAt: new Date(0) });
    await invite.validate();
    expect(invite.purgeAt.getTime()).toBe(expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(Invite.schema.path('status')).toBeUndefined();
  });
  it('includes the simplified optimistic version and section modification helper', async () => {
    const course = new Course({ slug: 'course-a', createdBy: '000000000000000000000001', draft: { details: {}, page: { schemaVersion: 1, sections: [{ id: 'one' }] }, form: {} } });
    course.markSectionContentModified();
    await course.validate();
    expect(course.version).toBe(0);
    expect(Course.schema.path('versions')).toBeUndefined();
    expect(Course.schema.path('review')).toBeUndefined();
    expect(course.isModified('draft.page.sections')).toBe(true);
  });
  it('rejects serialized course documents larger than 2 MB', async () => {
    const course = new Course({ slug: 'oversized-course', createdBy: '000000000000000000000001', draft: { details: { copy: 'x'.repeat(2 * 1024 * 1024) }, page: { schemaVersion: 1, sections: [] }, form: {} } });
    await expect(course.validate()).rejects.toThrow(/2 MB limit/);
  });
  it('generates unambiguous references and retries collisions', async () => {
    expect(generateEnrollmentReference()).toMatch(/^PAS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    const used = new Set<string>();
    const result = await generateUniqueEnrollmentReference(async (reference) => { if (used.has(reference)) return true; if (used.size === 0) { used.add(reference); return true; } return false; });
    expect(result).toMatch(/^PAS-/);
  });
  it('computes invite status from expiry and flags without a stored status field', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(getInviteStatus({ expiresAt: new Date('2026-01-02T00:00:00Z') }, now)).toBe('pending');
    expect(getInviteStatus({ expiresAt: new Date('2025-12-31T00:00:00Z') }, now)).toBe('expired');
    expect(getInviteStatus({ expiresAt: new Date('2026-01-02T00:00:00Z'), usedAt: now }, now)).toBe('accepted');
  });
});
