import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { AuthError, ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { withTransaction } from '../lib/withTransaction';
import { Invite } from '../models/Invite';
import type { InviteDocument } from '../models/Invite';
import { PasswordReset } from '../models/PasswordReset';
import { RefreshToken } from '../models/RefreshToken';
import { User } from '../models/User';
import { Settings } from '../models/Settings';
import { validatePasswordForEmail } from '../shared/schemas/authEndpoints';
import { PermissionKey } from '../shared/schemas/permissions';
import { writeAudit } from './audit';
import type { EmailTransport } from './emailTransport';
import { createAccessToken, createOpaqueToken, hashOpaqueToken, REFRESH_TOKEN_SECONDS, SYSTEM_ACTOR_ID, toAuthActor } from './authTokens';
import { hashPassword, verifyDummyPassword, verifyPassword } from './passwords';

const genericLoginError = 'Invalid email or password';
const genericTokenError = 'Invalid or expired link';
const resetExpireMs = 60 * 60 * 1000;

function permissionsObject(grants: readonly string[]) {
  return Object.fromEntries(Object.values(PermissionKey).map((key) => [key, grants.includes(key)])) as Record<(typeof PermissionKey)[keyof typeof PermissionKey], boolean>;
}

function inviteLink(environment: AppEnvironment, token: string): string {
  return `${environment.APP_BASE_URL.replace(/\/$/, '')}/ar/invite/${encodeURIComponent(token)}`;
}

export const authService = {
  async login(email: string, password: string, environment: AppEnvironment, logger: pino.Logger) {
    const normalized = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalized }).select('+passwordHash');
    const now = new Date();
    if (!user || !user.isActive) {
      await verifyDummyPassword(password);
      await writeAudit({ actorId: SYSTEM_ACTOR_ID, action: 'auth.login_failed', entityType: 'authentication', note: 'invalid_credentials' }, logger);
      throw new AuthError(genericLoginError);
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyPassword(password, user.passwordHash);
      await writeAudit({ actorId: String(user._id), action: 'auth.login_failed', entityType: 'authentication', entityId: String(user._id), note: 'account_locked' }, logger);
      throw new AuthError(genericLoginError);
    }
    if (user.lockedUntil && user.lockedUntil <= now) {
      user.lockedUntil = null;
      user.failedLoginCount = 0;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      user.failedLoginCount += 1;
      let locked = false;
      if (user.failedLoginCount >= 5) {
        user.lockedUntil = new Date(now.getTime() + 15 * 60 * 1000);
        locked = true;
      }
      await user.save();
      await writeAudit({ actorId: String(user._id), action: locked ? 'auth.account_locked' : 'auth.login_failed', entityType: 'authentication', entityId: String(user._id), afterStatus: locked ? 'locked' : 'invalid_credentials', note: locked ? 'five_failed_attempts' : 'invalid_credentials' }, logger);
      throw new AuthError(genericLoginError);
    }
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    await user.save();
    const refreshToken = createOpaqueToken();
    const familyId = randomUUID();
    await RefreshToken.create({ tokenHash: hashOpaqueToken(refreshToken), userId: user._id, familyId, tokenVersion: user.tokenVersion, expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000) });
    await writeAudit({ actorId: String(user._id), action: 'auth.login_succeeded', entityType: 'authentication', entityId: String(user._id), afterStatus: 'authenticated' }, logger);
    return { user: toAuthActor(user), accessToken: createAccessToken(user, environment), refreshToken };
  },

  async refresh(rawToken: string | undefined, environment: AppEnvironment, logger: pino.Logger) {
    if (!rawToken) throw new AuthError();
    const tokenHash = hashOpaqueToken(rawToken);
    const current = await RefreshToken.findOne({ tokenHash });
    if (!current) throw new AuthError();
    if (current.usedAt) {
      await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      await writeAudit({ actorId: String(current.userId), action: 'auth.refresh_reuse_detected', entityType: 'refresh_token_family', entityId: String(current._id), afterStatus: 'revoked', note: 'rotated_token_reused' }, logger);
      throw new AuthError();
    }
    const now = new Date();
    if (current.revokedAt || current.expiresAt <= now) throw new AuthError();
    const user = await User.findById(current.userId);
    if (!user || !user.isActive || current.tokenVersion !== user.tokenVersion) {
      await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: now } });
      throw new AuthError();
    }
    const nextRaw = createOpaqueToken();
    const rotated = await withTransaction(async (session) => {
      const consumed = await RefreshToken.findOneAndUpdate({ _id: current._id, usedAt: null, revokedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { new: true, session });
      if (!consumed) return false;
      await RefreshToken.create([{ tokenHash: hashOpaqueToken(nextRaw), userId: user._id, familyId: current.familyId, tokenVersion: user.tokenVersion, expiresAt: new Date(now.getTime() + REFRESH_TOKEN_SECONDS * 1000) }], { session });
      return true;
    });
    if (!rotated) {
      const latest = await RefreshToken.findById(current._id);
      if (latest?.usedAt) {
        await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
        await writeAudit({ actorId: String(user._id), action: 'auth.refresh_reuse_detected', entityType: 'refresh_token_family', entityId: String(current._id), afterStatus: 'revoked', note: 'rotated_token_reused' }, logger);
      }
      throw new AuthError();
    }
    return { user: toAuthActor(user), accessToken: createAccessToken(user, environment), refreshToken: nextRaw };
  },

  async logout(rawToken: string | undefined, logger: pino.Logger): Promise<void> {
    if (!rawToken) return;
    const current = await RefreshToken.findOne({ tokenHash: hashOpaqueToken(rawToken) });
    if (!current) return;
    await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await writeAudit({ actorId: String(current.userId), action: 'auth.logout', entityType: 'refresh_token_family', entityId: String(current._id), afterStatus: 'revoked' }, logger);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string, logger: pino.Logger): Promise<void> {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user || !await verifyPassword(currentPassword, user.passwordHash)) throw new AuthError('Current password is incorrect');
    try { validatePasswordForEmail(user.email, newPassword); } catch (error) { throw new ValidationError('Password does not meet the policy', error); }
    user.passwordHash = await hashPassword(newPassword);
    user.tokenVersion += 1;
    await user.save();
    await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await writeAudit({ actorId: String(user._id), action: 'auth.password_changed', entityType: 'user', entityId: String(user._id), afterStatus: 'credentials_rotated' }, logger);
  },

  async validateInvite(rawToken: string) {
    const invite = await Invite.findOne({ tokenHash: hashOpaqueToken(rawToken), usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!invite) throw new NotFoundError(genericTokenError);
    return { email: invite.email, role: invite.role, expiresAt: invite.expiresAt.toISOString() };
  },

  async acceptInvite(rawToken: string, name: string, password: string, logger: pino.Logger): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    const invite = await Invite.findOne({ tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!invite) throw new NotFoundError(genericTokenError);
    try { validatePasswordForEmail(invite.email, password); } catch (error) { throw new ValidationError('Password does not meet the policy', error); }
    if (await User.exists({ email: invite.email })) throw new ConflictError('An account already exists for this invitation');
    try { await withTransaction(async (session) => {
      const consumed = await Invite.findOneAndUpdate({ _id: invite._id, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true, session });
      if (!consumed) throw new NotFoundError(genericTokenError);
      const setting = await Settings.findOne({ key: 'academy' }).session(session).lean();
      const grants = consumed.role === 'admin' ? Object.values(PermissionKey) : [...new Set([...(setting?.staffDefaultPermissions ?? []), ...consumed.permissions])];
      const user = (await User.create([{ email: consumed.email, name, passwordHash: await hashPassword(password), role: consumed.role, permissions: permissionsObject(grants), settingsPermissionsApplied: true, isActive: true }], { session }))[0];
      if (!user) throw new ConflictError('Could not create the invited user');
    }); } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw new ConflictError('An account already exists for this invitation');
      throw error;
    }
    await writeAudit({ actorId: String(invite.invitedBy), action: 'invite.accepted', entityType: 'invite', entityId: String(invite._id), afterStatus: 'accepted' }, logger);
  },

  async requestPasswordReset(email: string, environment: AppEnvironment, transport: EmailTransport, logger: pino.Logger): Promise<void> {
    const user = await User.findOne({ email: email.trim().toLowerCase(), isActive: true });
    if (!user) {
      await writeAudit({ actorId: SYSTEM_ACTOR_ID, action: 'auth.password_reset_requested', entityType: 'password_reset', afterStatus: 'not_found', note: 'request_received' }, logger);
      return;
    }
    await PasswordReset.deleteMany({ userId: user._id, usedAt: null });
    const raw = createOpaqueToken();
    const expiresAt = new Date(Date.now() + resetExpireMs);
    await PasswordReset.create({ tokenHash: hashOpaqueToken(raw), userId: user._id, expiresAt });
    const link = `${environment.APP_BASE_URL.replace(/\/$/, '')}/ar/reset-password/${encodeURIComponent(raw)}`;
    try { await transport.sendPasswordResetLink(user.email, link, logger); }
    catch (error) { logger.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Password reset delivery failed'); }
    await writeAudit({ actorId: String(user._id), action: 'auth.password_reset_requested', entityType: 'user', entityId: String(user._id), afterStatus: 'requested' }, logger);
  },

  async confirmPasswordReset(rawToken: string, password: string, logger: pino.Logger): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    const reset = await PasswordReset.findOne({ tokenHash, usedAt: null, expiresAt: { $gt: new Date() } });
    if (!reset) throw new NotFoundError(genericTokenError);
    const user = await User.findById(reset.userId);
    if (!user || !user.isActive) throw new NotFoundError(genericTokenError);
    try { validatePasswordForEmail(user.email, password); } catch (error) { throw new ValidationError('Password does not meet the policy', error); }
    await withTransaction(async (session) => {
      const consumed = await PasswordReset.findOneAndUpdate({ _id: reset._id, usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true, session });
      if (!consumed) throw new NotFoundError(genericTokenError);
      const currentUser = await User.findById(user._id).session(session);
      if (!currentUser || !currentUser.isActive) throw new NotFoundError(genericTokenError);
      currentUser.passwordHash = await hashPassword(password);
      currentUser.tokenVersion += 1;
      await currentUser.save({ session });
      await RefreshToken.updateMany({ userId: currentUser._id, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session });
    });
    await writeAudit({ actorId: String(user._id), action: 'auth.password_reset_completed', entityType: 'user', entityId: String(user._id), afterStatus: 'credentials_rotated' }, logger);
  },

  async createInvite(input: { email: string; name?: string; role: 'admin' | 'assistant'; permissions: string[]; hours: 24 | 72 | 168 }, actorId: string, environment: AppEnvironment, transport: EmailTransport, logger: pino.Logger) {
    const email = input.email.trim().toLowerCase();
    if (await User.exists({ email, isActive: true })) throw new ConflictError('An active user already has this email');
    if (await Invite.exists({ email, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } })) throw new ConflictError('A pending invite already exists for this email');
    const raw = createOpaqueToken();
    const expiresAt = new Date(Date.now() + input.hours * 60 * 60 * 1000);
    const invite = await Invite.create({ tokenHash: hashOpaqueToken(raw), email, role: input.role, permissions: input.permissions, invitedBy: actorId, expiresAt, purgeAt: new Date(expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000) });
    const link = inviteLink(environment, raw);
    await transport.sendInviteLink(email, link, logger);
    await writeAudit({ actorId, action: 'invite.created', entityType: 'invite', entityId: String(invite._id), afterStatus: 'pending' }, logger);
    return { invite: safeInvite(invite), link };
  },

  async listInvites(page: number, pageSize: number, status?: string, search?: string) {
    const filter: Record<string, unknown> = {};
    if (search) filter.email = { $regex: escapeRegex(search), $options: 'i' };
    const now = new Date();
    if (status === 'pending') Object.assign(filter, { usedAt: null, revokedAt: null, expiresAt: { $gt: now } });
    if (status === 'accepted') filter.usedAt = { $ne: null };
    if (status === 'revoked') filter.revokedAt = { $ne: null };
    if (status === 'expired') Object.assign(filter, { usedAt: null, revokedAt: null, expiresAt: { $lte: now } });
    const query = Invite.find(filter).sort({ createdAt: -1 });
    const [records, total] = await Promise.all([query.skip((page - 1) * pageSize).limit(pageSize), Invite.countDocuments(filter)]);
    const items = records.map((record) => ({ ...safeInvite(record), status: record.usedAt ? 'accepted' : record.revokedAt ? 'revoked' : record.expiresAt <= now ? 'expired' : 'pending' }));
    return { items, total, page, pageSize };
  },

  async revokeInvite(inviteId: string, actorId: string, logger: pino.Logger): Promise<void> {
    const invite = await Invite.findOneAndUpdate({ _id: inviteId, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }, { $set: { revokedAt: new Date() } }, { new: true });
    if (!invite) throw new NotFoundError('Pending invite not found');
    await writeAudit({ actorId, action: 'invite.revoked', entityType: 'invite', entityId: String(invite._id), beforeStatus: 'pending', afterStatus: 'revoked' }, logger);
  },

  async resendInvite(inviteId: string, actorId: string, environment: AppEnvironment, transport: EmailTransport, logger: pino.Logger) {
    const invite = await Invite.findOne({ _id: inviteId, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!invite) throw new NotFoundError('Pending invite not found');
    const raw = createOpaqueToken();
    invite.tokenHash = hashOpaqueToken(raw);
    invite.expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    invite.purgeAt = new Date(invite.expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await invite.save();
    const link = inviteLink(environment, raw);
    await transport.sendInviteLink(invite.email, link, logger);
    await writeAudit({ actorId, action: 'invite.resent', entityType: 'invite', entityId: String(invite._id), beforeStatus: 'pending', afterStatus: 'pending' }, logger);
    return { invite: safeInvite(invite), link };
  },
};

function safeInvite(invite: InviteDocument) {
  return { id: String(invite._id), email: invite.email, role: invite.role, permissions: invite.permissions, invitedBy: String(invite.invitedBy), createdAt: invite.createdAt, expiresAt: invite.expiresAt, status: invite.usedAt ? 'accepted' : invite.revokedAt ? 'revoked' : invite.expiresAt <= new Date() ? 'expired' : 'pending' };
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
