import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { AuditLog } from '../models/AuditLog';
import { Invite } from '../models/Invite';
import { PasswordReset } from '../models/PasswordReset';
import { RefreshToken } from '../models/RefreshToken';
import { User } from '../models/User';
import type { EmailTransport } from '../services/emailTransport';
import { hashOpaqueToken } from '../services/authTokens';
import { verifyAccessToken } from '../services/authTokens';
import { hashPassword } from '../services/passwords';
import { seedAdmin } from '../services/seedAdmin';
import { usersService } from '../services/usersService';
import { redactAuditValue } from '../services/audit';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';
import * as passwordService from '../services/passwords';

const uri = process.env.MONGODB_URI_TEST;
const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');
if (!uri) throw new Error('BE-3 auth integration tests require MONGODB_URI_TEST; skipped tests are not accepted.');
if (process.env.NODE_ENV !== 'test') throw new Error('BE-3 auth tests require NODE_ENV=test.');
const env = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: 'mongodb://127.0.0.1:27017/passion_test?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'be3-test-access-secret-long-enough-00001', REFRESH_TOKEN_SECRET: 'be3-test-refresh-secret-long-enough-0002',
  COOKIE_DOMAIN: '127.0.0.1', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});
const logger = createLogger('silent');
const origin = env.CORS_ORIGINS[0]!;
const adminPassword = 'AdminPassphrase7!';
const assistantPassword = 'AssistantPhrase8!';
const collections = [User, Invite, PasswordReset, RefreshToken, AuditLog].map((model) => model.collection.name);
let resetLinks: string[] = [];
const transport: EmailTransport = {
  async sendInviteLink(_email, link) { resetLinks.push(link); },
  async sendPasswordResetLink(_email, link) { resetLinks.push(link); },
};
const app = createApp(env, { logger, emailTransport: transport });
const agent = () => request.agent(app);
const csrfTokens = new WeakMap<object, string>();
const authCookies = new WeakMap<object, string>();
async function csrf(client: ReturnType<typeof agent>): Promise<string> {
  const response = await client.get('/api/v1/auth/csrf').expect(200);
  csrfTokens.set(client, response.body.csrfToken as string);
  return response.body.csrfToken as string;
}
async function login(client: ReturnType<typeof agent>, email: string, password: string) {
  const token = await csrf(client);
  csrfTokens.set(client, token);
  const response = await client.post('/api/v1/auth/login').set('Origin', origin).set('X-CSRF-Token', token).set('Cookie', `passion_csrf=${token}`).send({ email, password });
  authCookies.set(client, setCookies(response).map((cookie) => cookie.split(';')[0]!.trim()).join('; '));
  return response;
}
async function loginExpected(client: ReturnType<typeof agent>, email: string, password: string, status: number) {
  const response = await login(client, email, password);
  expect(response.status).toBe(status);
  return response;
}
function adminRequest(client: ReturnType<typeof agent>, method: 'post' | 'patch', path: string, body?: unknown) {
  const token = csrfTokens.get(client);
  if (!token) throw new Error('CSRF token is not initialized for test agent');
  return client[method](path).set('Origin', origin).set('X-CSRF-Token', token).set('Cookie', `${authCookies.get(client) ?? ''}; passion_csrf=${token}`).send(body ?? {});
}
function authGet(client: ReturnType<typeof agent>, path: string) { return client.get(path).set('Cookie', authCookies.get(client) ?? ''); }
async function createUser(email: string, role: 'admin' | 'assistant', password = role === 'admin' ? adminPassword : assistantPassword, permissions: Record<string, boolean> = {}) {
  return User.create({ email, name: role === 'admin' ? 'مدير' : 'مساعد', role, passwordHash: await hashPassword(password), permissions, isActive: true });
}
function tokenFromLink(link: string): string { return new URL(link).pathname.split('/').at(-1)!; }
function setCookies(response: Response): string[] {
  const value = response.headers['set-cookie'];
  const values: string[] = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values.flatMap((cookie: string) => cookie.split(/,(?=\s*passion_)/).map((part: string) => part.trim()));
}

beforeAll(async () => {
  await mongoose.connect(uri!, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, collections);
}, 60_000);
afterEach(async () => {
  resetLinks = [];
  await clearNamedCollections(mongoose.connection, collections);
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await clearNamedCollections(mongoose.connection, collections);
    await mongoose.disconnect();
  }
});

describe('BE-3 auth, RBAC and account workflows (Atlas passion_test)', () => {
  it('login success and wrong/unknown credentials share a generic response; unknown users execute the dummy Argon2 path', async () => {
    await createUser('admin-b3@example.test', 'admin');
    const client = agent();
    const success = await loginExpected(client, 'admin-b3@example.test', adminPassword, 200);
    expect(success.body.user).toMatchObject({ email: 'admin-b3@example.test', role: 'admin' });
    expect(success.body).not.toHaveProperty('accessToken');
    expect(setCookies(success).join(';')).toContain('passion_access=');
    expect(authCookies.get(client)?.split(';').map((cookie) => cookie.split('=')[0]!.trim())).toEqual(['passion_access', 'passion_refresh']);
    const accessToken = authCookies.get(client)!.split(';')[0]!.split('=').slice(1).join('=');
    const claims = verifyAccessToken(accessToken, env);
    expect((await User.findById(claims.userId))?.tokenVersion).toBe(claims.tokenVersion);
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', authCookies.get(client)!).expect(200);
    expect(me.body.user.email).toBe('admin-b3@example.test');
    const wrong = await loginExpected(agent(), 'admin-b3@example.test', 'WrongPassword9!', 401);
    const dummySpy = vi.spyOn(passwordService, 'verifyDummyPassword');
    const missing = await loginExpected(agent(), 'unknown-b3@example.test', 'WrongPassword9!', 401);
    expect(missing.body.error.message).toBe(wrong.body.error.message);
    expect(dummySpy).toHaveBeenCalledOnce();
    dummySpy.mockRestore();
  });

  it('locks after five consecutive failures and clears the lock after expiry', async () => {
    const user = await createUser('lock-b3@example.test', 'assistant');
    const client = agent();
    for (let attempt = 0; attempt < 5; attempt += 1) await loginExpected(client, user.email, 'WrongPassword9!', 401);
    const locked = await User.findById(user._id);
    expect(locked?.failedLoginCount).toBe(5);
    expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    await User.updateOne({ _id: user._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    await loginExpected(agent(), user.email, assistantPassword, 200);
    const unlocked = await User.findById(user._id);
    expect(unlocked?.failedLoginCount).toBe(0);
    expect(unlocked?.lockedUntil).toBeNull();
  });

  it('changes password only with the current password, then invalidates the prior access and refresh session', async () => {
    const user = await createUser('change-b3@example.test', 'assistant');
    const client = agent();
    const session = await loginExpected(client, user.email, assistantPassword, 200);
    const token = csrfTokens.get(client)!;
    await client.post('/api/v1/auth/change-password').set('Cookie', `${authCookies.get(client)}; passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).send({ currentPassword: assistantPassword, password: 'ChangedPassword9!' }).expect(204);
    const access = setCookies(session).find((cookie) => cookie.startsWith('passion_access='))!.split(';')[0]!;
    await request(app).get('/api/v1/auth/me').set('Cookie', access).expect(401);
    expect(await RefreshToken.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
    await loginExpected(agent(), user.email, assistantPassword, 401);
    await loginExpected(agent(), user.email, 'ChangedPassword9!', 200);
    expect((await AuditLog.find({ actorId: user._id })).some((event) => event.action === 'auth.password_changed')).toBe(true);
  });

  it('rate limits repeated login attempts by a hashed email key', async () => {
    const throttledApp = createApp(env, { logger });
    const csrfResponse = await request(throttledApp).get('/api/v1/auth/csrf').expect(200);
    const token = csrfResponse.body.csrfToken as string;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(throttledApp).post('/api/v1/auth/login').set('Cookie', `passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).send({ email: 'email-limit-b3@example.test', password: 'WrongPassword9!' }).expect(401);
    }
    const limited = await request(throttledApp).post('/api/v1/auth/login').set('Cookie', `passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).send({ email: 'email-limit-b3@example.test', password: 'WrongPassword9!' }).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('rate limits login attempts by client IP across different email addresses', async () => {
    const throttledApp = createApp(env, { logger });
    const csrfResponse = await request(throttledApp).get('/api/v1/auth/csrf').expect(200);
    const token = csrfResponse.body.csrfToken as string;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(throttledApp).post('/api/v1/auth/login').set('Cookie', `passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).send({ email: `ip-limit-${attempt}@example.test`, password: 'WrongPassword9!' }).expect(401);
    }
    const limited = await request(throttledApp).post('/api/v1/auth/login').set('Cookie', `passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).send({ email: 'ip-limit-final@example.test', password: 'WrongPassword9!' }).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('rotates refresh tokens and revokes the whole family when a rotated token is reused', async () => {
    await createUser('refresh-b3@example.test', 'assistant');
    const firstClient = agent();
    const first = await loginExpected(firstClient, 'refresh-b3@example.test', assistantPassword, 200);
    const oldCookie = setCookies(first).find((value) => value.startsWith('passion_refresh='))!;
    const oldToken = decodeURIComponent(oldCookie.split(';')[0]!.split('=').slice(1).join('='));
    const csrfToken = await csrf(firstClient);
    const csrfCookie = `passion_csrf=${csrfToken}`;
    const rotated = await firstClient.post('/api/v1/auth/refresh').set('Cookie', `${oldCookie.split(';')[0]}; ${csrfCookie}`).set('Origin', origin).set('X-CSRF-Token', csrfToken).expect(200);
    const current = await RefreshToken.findOne({ tokenHash: hashOpaqueToken(oldToken) });
    expect(current?.usedAt).toBeTruthy();
    await request(app).post('/api/v1/auth/refresh').set('Cookie', `${csrfCookie}; ${oldCookie.split(';')[0]}`).set('Origin', origin).set('X-CSRF-Token', decodeURIComponent(csrfCookie.split('=').slice(1).join('='))).expect(401);
    const family = await RefreshToken.find({ userId: (await User.findOne({ email: 'refresh-b3@example.test' }))!._id });
    expect(family.length).toBe(2);
    expect(family.every((item) => item.revokedAt)).toBe(true);
    expect(rotated.body).not.toHaveProperty('refreshToken');
  });

  it('CSRF rejects missing/incorrect headers and disallowed Origins', async () => {
    await request(app).post('/api/v1/auth/login').set('Origin', origin).send({ email: 'any@example.test', password: 'AnyPassword1!' }).expect(403);
    const token = await csrf(agent());
    await request(app).post('/api/v1/auth/login').set('Cookie', `passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', 'wrong').send({ email: 'any@example.test', password: 'AnyPassword1!' }).expect(403);
    await request(app).post('/api/v1/auth/login').set('Cookie', `passion_csrf=${token}`).set('Origin', 'https://evil.example').set('X-CSRF-Token', token).send({ email: 'any@example.test', password: 'AnyPassword1!' }).expect(403);
  });

  it('logout revokes the refresh family and invalidates refresh requests', async () => {
    await createUser('logout-b3@example.test', 'assistant');
    const client = agent();
    const logged = await loginExpected(client, 'logout-b3@example.test', assistantPassword, 200);
    const token = await csrf(client);
    await client.post('/api/v1/auth/logout').set('Cookie', `${authCookies.get(client)}; passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).expect(204);
    const oldRefresh = setCookies(logged).find((value) => value.startsWith('passion_refresh='))!.split(';')[0]!;
    const rawCsrf = csrfTokens.get(client)!;
    await request(app).post('/api/v1/auth/refresh').set('Cookie', `passion_csrf=${rawCsrf}; ${oldRefresh}`).set('Origin', origin).set('X-CSRF-Token', rawCsrf).expect(401);
  });

  it('deactivation bumps tokenVersion and rejects an otherwise valid access cookie', async () => {
    await createUser('version-admin@example.test', 'admin');
    const assistant = await createUser('version-assistant@example.test', 'assistant');
    const assistantClient = agent();
    const session = await loginExpected(assistantClient, assistant.email, assistantPassword, 200);
    const adminClient = agent();
    await loginExpected(adminClient, 'version-admin@example.test', adminPassword, 200);
    await adminRequest(adminClient, 'post', `/api/v1/users/${assistant._id}/deactivate`).expect(200);
    const accessCookie = setCookies(session).find((value) => value.startsWith('passion_access='))!.split(';')[0]!;
    await request(app).get('/api/v1/auth/me').set('Cookie', accessCookie).expect(401);
    expect((await User.findById(assistant._id))?.tokenVersion).toBe(1);
  });

  it('invites create, validate, accept once; expired/revoked links fail and resend rotates the token', async () => {
    await createUser('invite-admin@example.test', 'admin');
    const adminClient = agent();
    await loginExpected(adminClient, 'invite-admin@example.test', adminPassword, 200);
    const created = await adminRequest(adminClient, 'post', '/api/v1/invites', { email: 'new-assistant@example.test', role: 'assistant', permissions: ['exportCsv'], hours: 24 }).expect(201);
    expect(created.body.invite).not.toHaveProperty('tokenHash');
    const token = tokenFromLink(created.body.link);
    const validatedInvite = await request(app).get(`/api/v1/auth/invites/${token}`).expect(200);
    expect(validatedInvite.body).toMatchObject({ email: 'new-assistant@example.test', role: 'assistant' });
    expect(typeof validatedInvite.body.expiresAt).toBe('string');
    const acceptClient = agent();
    const acceptCsrf = await csrf(acceptClient);
    await acceptClient.post('/api/v1/auth/invites/accept').set('Cookie', `passion_csrf=${acceptCsrf}`).set('Origin', origin).set('X-CSRF-Token', acceptCsrf).send({ token, name: 'مساعد جديد', password: 'InvitePassphrase9!' }).expect(201);
    await request(app).get(`/api/v1/auth/invites/${token}`).expect(404);
    const acceptedAgain = await acceptClient.post('/api/v1/auth/invites/accept').set('Cookie', `passion_csrf=${acceptCsrf}`).set('Origin', origin).set('X-CSRF-Token', acceptCsrf).send({ token, name: 'مساعد', password: 'InvitePassphrase9!' }).expect(404);
    expect(acceptedAgain.body.error.code).toBe('NOT_FOUND');

    const expiredRaw = 'e'.repeat(64);
    await Invite.create({ tokenHash: hashOpaqueToken(expiredRaw), email: 'expired@example.test', role: 'assistant', invitedBy: (await User.findOne({ email: 'invite-admin@example.test' }))!._id, expiresAt: new Date(Date.now() - 1000), purgeAt: new Date(Date.now() + 100000) });
    await request(app).get(`/api/v1/auth/invites/${expiredRaw}`).expect(404);
    const revoked = await adminRequest(adminClient, 'post', '/api/v1/invites', { email: 'revoked@example.test', role: 'assistant', permissions: [], hours: 24 }).expect(201);
    const revokedToken = tokenFromLink(revoked.body.link);
    await adminRequest(adminClient, 'post', `/api/v1/invites/${revoked.body.invite.id}/revoke`).expect(204);
    await request(app).get(`/api/v1/auth/invites/${revokedToken}`).expect(404);
    const pending = await adminRequest(adminClient, 'post', '/api/v1/invites', { email: 'resend@example.test', role: 'assistant', permissions: [], hours: 24 }).expect(201);
    const oldToken = tokenFromLink(pending.body.link);
    const resent = await adminRequest(adminClient, 'post', `/api/v1/invites/${pending.body.invite.id}/resend`).expect(200);
    expect(tokenFromLink(resent.body.link)).not.toBe(oldToken);
    await request(app).get(`/api/v1/auth/invites/${oldToken}`).expect(404);
    await request(app).get(`/api/v1/auth/invites/${tokenFromLink(resent.body.link)}`).expect(200);
  });

  it('password reset is neutral for unknown emails and is single use for a known user', async () => {
    const user = await createUser('reset-b3@example.test', 'assistant');
    const client = agent();
    const csrfToken = await csrf(client);
    const unknown = await client.post('/api/v1/auth/password-reset/request').set('Cookie', `passion_csrf=${csrfToken}`).set('Origin', origin).set('X-CSRF-Token', csrfToken).send({ email: 'missing-reset@example.test' }).expect(202);
    const known = await client.post('/api/v1/auth/password-reset/request').set('Cookie', `passion_csrf=${csrfToken}`).set('Origin', origin).set('X-CSRF-Token', csrfToken).send({ email: user.email }).expect(202);
    expect(known.body).toEqual(unknown.body);
    const link = resetLinks.find((value) => value.includes('/reset-password/'))!;
    const token = tokenFromLink(link);
    expect((await PasswordReset.findOne({ userId: user._id }))?.tokenHash).not.toBe(token);
    const confirm = await csrf(client);
    await client.post('/api/v1/auth/password-reset/confirm').set('Cookie', `passion_csrf=${confirm}`).set('Origin', origin).set('X-CSRF-Token', confirm).send({ token, password: 'NewResetPassword2!' }).expect(204);
    await client.post('/api/v1/auth/password-reset/confirm').set('Cookie', `passion_csrf=${confirm}`).set('Origin', origin).set('X-CSRF-Token', confirm).send({ token, password: 'NewResetPassword2!' }).expect(404);
    expect((await RefreshToken.countDocuments({ userId: user._id, revokedAt: null }))).toBe(0);
  });

  it('prevents last-admin demotion/deactivation and self-demotion; assistant cannot call admin routes', async () => {
    const admin = await createUser('safeguard-admin@example.test', 'admin');
    await expect(usersService.assertAnotherAdmin(String(admin._id))).rejects.toMatchObject({ code: 'CONFLICT' });
    const client = agent();
    await loginExpected(client, admin.email, adminPassword, 200);
    await adminRequest(client, 'patch', `/api/v1/users/${admin._id}`, { role: 'assistant' }).expect(403);
    await adminRequest(client, 'post', `/api/v1/users/${admin._id}/deactivate`).expect(403);
    await createUser('safeguard-assistant@example.test', 'assistant');
    const assistantClient = agent();
    await loginExpected(assistantClient, 'safeguard-assistant@example.test', assistantPassword, 200);
    await authGet(assistantClient, '/api/v1/users').expect(403);
    await authGet(assistantClient, '/api/v1/invites').expect(403);
  });

  it('returns server-computed default plus granted permissions and never returns password/token hashes', async () => {
    const assistant = await createUser('permissions-assistant@example.test', 'assistant');
    const adminClient = agent();
    await createUser('permissions-admin@example.test', 'admin');
    await loginExpected(adminClient, 'permissions-admin@example.test', adminPassword, 200);
    await adminRequest(adminClient, 'patch', `/api/v1/users/${assistant._id}`, { permissions: ['exportCsv'] }).expect(200);
    const client = agent();
    await loginExpected(client, 'permissions-assistant@example.test', assistantPassword, 200);
    const response = await authGet(client, '/api/v1/auth/me').expect(200);
    expect(response.body.user.permissions).toEqual(expect.arrayContaining(['viewLeads', 'updateFollowUp', 'viewPayments', 'manageNotes', 'exportCsv']));
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|tokenHash|refreshToken|accessToken/);
    const listed = await authGet(adminClient, '/api/v1/users').expect(200);
    expect(JSON.stringify(listed.body)).not.toMatch(/passwordHash|tokenHash/);
    expect(listed.body.items.find((item: { id: string }) => item.id === assistant.id)).toMatchObject({ active: true, name: { ar: 'مساعد' } });
  });

  it('writes audit events without credentials, tokens, or unnecessary email data', async () => {
    await createUser('audit-admin@example.test', 'admin');
    const client = agent();
    await loginExpected(client, 'audit-admin@example.test', adminPassword, 200);
    const token = await csrf(client);
    await client.post('/api/v1/auth/logout').set('Cookie', `${authCookies.get(client)}; passion_csrf=${token}`).set('Origin', origin).set('X-CSRF-Token', token).expect(204);
    const events = await AuditLog.find({}).lean();
    expect(events.some((entry) => entry.action === 'auth.login_succeeded')).toBe(true);
    expect(events.some((entry) => entry.action === 'auth.logout')).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(adminPassword);
    expect(serialized).not.toMatch(/tokenHash|passwordHash|authorization|cookie/i);
    expect(events.some((entry) => JSON.stringify(entry).includes('audit-admin@example.test'))).toBe(false);
    expect(redactAuditValue({ safe: 'kept', nested: [{ cookie: 'hidden', password: 'hidden', token: 'hidden', authorization: 'hidden', secret: 'hidden' }] })).toEqual({ safe: 'kept', nested: [{}] });
  });

  it('seed admin is idempotent and never overwrites an existing account', async () => {
    expect(await seedAdmin({ email: 'seed-b3@example.test', name: 'Seed Admin', password: 'SeedAdminPassword4!' }, logger)).toBe('created');
    expect(await seedAdmin({ email: 'seed-b3@example.test', name: 'Changed Name', password: 'OtherPassword5!' }, logger)).toBe('exists');
    expect(await User.countDocuments({ email: 'seed-b3@example.test' })).toBe(1);
    const record = await User.findOne({ email: 'seed-b3@example.test' }).select('+passwordHash');
    expect(record?.name).toBe('Seed Admin');
    expect(await passwordService.verifyPassword('SeedAdminPassword4!', record!.passwordHash)).toBe(true);
  });
});
