import { createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { RateLimitError } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { csrfController, csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { changePasswordBodySchema, inviteAcceptBodySchema, inviteTokenParamsSchema, loginBodySchema, resetConfirmBodySchema, resetRequestBodySchema } from '../shared/schemas/authEndpoints';
import { authService } from '../services/authService';
import { clearAuthCookies, cookieNames, setAuthCookies } from '../services/authTokens';
import type { EmailTransport } from '../services/emailTransport';

export function authRouter(environment: AppEnvironment, logger: pino.Logger, transport: EmailTransport) {
  const router = Router();
  const ipLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, _res, next) => next(new RateLimitError('Too many login attempts')) });
  const emailLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (request) => createHash('sha256').update(String(request.body?.email ?? '').trim().toLowerCase()).digest('hex'), handler: (_req, _res, next) => next(new RateLimitError('Too many login attempts')) });
  router.get('/csrf', csrfController(environment));
  router.post('/login', ...csrfProtection(environment), validateRequest({ body: loginBodySchema }), ipLimit, emailLimit, asyncHandler(async (req, res) => {
    const result = await authService.login(req.body.email, req.body.password, environment, logger);
    setAuthCookies(res, environment, result.accessToken, result.refreshToken);
    res.json({ user: result.user });
  }));
  router.post('/refresh', ...csrfProtection(environment), asyncHandler(async (req, res) => {
    const token = req.cookies?.[cookieNames(environment).refresh];
    const result = await authService.refresh(token, environment, logger);
    setAuthCookies(res, environment, result.accessToken, result.refreshToken);
    res.json({ user: result.user });
  }));
  router.post('/logout', ...csrfProtection(environment), asyncHandler(async (req, res) => {
    await authService.logout(req.cookies?.[cookieNames(environment).refresh], logger);
    clearAuthCookies(res, environment);
    res.status(204).end();
  }));
  router.get('/me', requireAuth(environment), requireRole('admin', 'assistant'), (req, res) => res.json({ user: req.auth }));
  router.post('/change-password', ...csrfProtection(environment), requireAuth(environment), requireRole('admin', 'assistant'), validateRequest({ body: changePasswordBodySchema }), asyncHandler(async (req, res) => {
    await authService.changePassword(req.auth!.id, req.body.currentPassword, req.body.password, logger);
    clearAuthCookies(res, environment);
    res.status(204).end();
  }));
  router.get('/invites/:token', validateRequest({ params: inviteTokenParamsSchema }), asyncHandler(async (req, res) => res.json(await authService.validateInvite(String(req.params.token)))));
  router.post('/invites/accept', ...csrfProtection(environment), validateRequest({ body: inviteAcceptBodySchema }), asyncHandler(async (req, res) => {
    await authService.acceptInvite(req.body.token, req.body.name, req.body.password, logger);
    res.status(201).json({ accepted: true });
  }));
  router.post('/password-reset/request', ...csrfProtection(environment), validateRequest({ body: resetRequestBodySchema }), asyncHandler(async (req, res) => {
    await authService.requestPasswordReset(req.body.email, environment, transport, logger);
    res.status(202).json({ accepted: true });
  }));
  router.post('/password-reset/confirm', ...csrfProtection(environment), validateRequest({ body: resetConfirmBodySchema }), asyncHandler(async (req, res) => {
    await authService.confirmPasswordReset(req.body.token, req.body.password, logger);
    res.status(204).end();
  }));
  return router;
}
