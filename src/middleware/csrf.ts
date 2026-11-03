import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AppEnvironment } from '../config/env';
import { ForbiddenError } from '../lib/errors';
import { cookieNames, safeEqual, setCsrfCookie } from '../services/authTokens';

export function csrfController(environment: AppEnvironment): RequestHandler {
  return (_request, response) => {
    const token = randomBytes(32).toString('base64url');
    setCsrfCookie(response, environment, token);
    response.status(200).json({ csrfToken: token });
  };
}

export function requireSameOrigin(environment: AppEnvironment): RequestHandler {
  const allowlist = new Set(environment.CORS_ORIGINS);
  return (request, _response, next) => {
    const candidate = request.get('origin') ?? request.get('referer');
    if (!candidate) return next(new ForbiddenError('Request origin is required'));
    let origin: string;
    try { origin = new URL(candidate).origin; } catch { return next(new ForbiddenError('Request origin is not allowed')); }
    if (!allowlist.has(origin)) return next(new ForbiddenError('Request origin is not allowed'));
    next();
  };
}

export function requireCsrf(environment: AppEnvironment): RequestHandler {
  const names = cookieNames(environment);
  return (request, _response, next) => {
    const cookie = request.cookies?.[names.csrf];
    const header = request.get('x-csrf-token');
    if (typeof cookie !== 'string' || typeof header !== 'string' || !safeEqual(cookie, header)) return next(new ForbiddenError('CSRF token is missing or invalid'));
    next();
  };
}

export function csrfProtection(environment: AppEnvironment): RequestHandler[] {
  return [requireSameOrigin(environment), requireCsrf(environment)];
}
