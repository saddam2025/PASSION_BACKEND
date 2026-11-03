import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { AppEnvironment } from '../config/env';
import type { UserDocument } from '../models/User';
import type { AuthActor } from '../types/express';
import { rolePermissionDefaults } from '../shared/schemas/permissions';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_SECONDS = 7 * 24 * 60 * 60;
export const SYSTEM_ACTOR_ID = '000000000000000000000000';

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createOpaqueToken(): string { return randomBytes(48).toString('base64url'); }

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function effectivePermissions(user: Pick<UserDocument, 'role' | 'permissions' | 'settingsPermissionsApplied'>): AuthActor['permissions'] {
  if (user.role === 'admin') return [...rolePermissionDefaults.admin];
  // Scope V1 fixes Assistant rights by role. Legacy per-user grants remain stored
  // for migration compatibility, but cannot widen the role's capabilities.
  return [...rolePermissionDefaults.assistant];
}

export function toAuthActor(user: UserDocument): AuthActor {
  return { id: String(user._id), name: { ar: user.name }, email: user.email, role: user.role, permissions: effectivePermissions(user) };
}

export function createAccessToken(user: UserDocument, environment: AppEnvironment): string {
  return jwt.sign({ tokenVersion: user.tokenVersion, typ: 'access' }, environment.ACCESS_TOKEN_SECRET, {
    algorithm: 'HS256', subject: String(user._id), issuer: 'passion-platform-api', audience: 'passion-platform-web', expiresIn: ACCESS_TOKEN_SECONDS,
  });
}

export function verifyAccessToken(token: string, environment: AppEnvironment): { userId: string; tokenVersion: number } {
  const decoded = jwt.verify(token, environment.ACCESS_TOKEN_SECRET, { algorithms: ['HS256'], issuer: 'passion-platform-api', audience: 'passion-platform-web' });
  if (typeof decoded === 'string' || !(decoded as JwtPayload).sub || !Number.isInteger((decoded as JwtPayload).tokenVersion) || (decoded as JwtPayload).typ !== 'access') throw new Error('Invalid access token');
  return { userId: (decoded as JwtPayload).sub as string, tokenVersion: (decoded as JwtPayload).tokenVersion as number };
}

export interface CookieNames { access: string; refresh: string; csrf: string; accessPath: string; refreshPath: string; csrfPath: string }
export function cookieNames(environment: AppEnvironment): CookieNames {
  if (environment.NODE_ENV === 'production') {
    // __Host- cookies must use Path=/ and omit Domain; this conflicts with refresh-path narrowing.
    return { access: '__Host-access', refresh: '__Host-refresh', csrf: '__Host-csrf', accessPath: '/', refreshPath: '/', csrfPath: '/' };
  }
  return { access: 'passion_access', refresh: 'passion_refresh', csrf: 'passion_csrf', accessPath: '/api/v1', refreshPath: '/api/v1/auth', csrfPath: '/api/v1' };
}

function cookieOptions(environment: AppEnvironment, path: string, httpOnly: boolean, maxAge?: number): CookieOptions {
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(environment.COOKIE_DOMAIN.toLowerCase());
  const domain = environment.NODE_ENV !== 'production' && !localHost ? { domain: environment.COOKIE_DOMAIN } : {};
  return { httpOnly, secure: environment.COOKIE_SECURE || environment.NODE_ENV === 'production', sameSite: environment.COOKIE_SAME_SITE, path, ...domain, ...(maxAge === undefined ? {} : { maxAge: maxAge * 1000 }) };
}

export function setCsrfCookie(response: Response, environment: AppEnvironment, token: string): void {
  const names = cookieNames(environment);
  response.cookie(names.csrf, token, cookieOptions(environment, names.csrfPath, false, 60 * 60 * 24));
}

export function setAuthCookies(response: Response, environment: AppEnvironment, accessToken: string, refreshToken: string): void {
  const names = cookieNames(environment);
  response.cookie(names.access, accessToken, cookieOptions(environment, names.accessPath, true, ACCESS_TOKEN_SECONDS));
  response.cookie(names.refresh, refreshToken, cookieOptions(environment, names.refreshPath, true, REFRESH_TOKEN_SECONDS));
}

export function clearAuthCookies(response: Response, environment: AppEnvironment): void {
  const names = cookieNames(environment);
  response.clearCookie(names.access, cookieOptions(environment, names.accessPath, true));
  response.clearCookie(names.refresh, cookieOptions(environment, names.refreshPath, true));
}
