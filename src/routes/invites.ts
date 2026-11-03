import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { inviteCreateBodySchema, inviteListQuerySchema, tokenIdParamsSchema } from '../shared/schemas/authEndpoints';
import { authService } from '../services/authService';
import type { EmailTransport } from '../services/emailTransport';

export function invitesRouter(environment: AppEnvironment, logger: pino.Logger, transport: EmailTransport) {
  const router = Router();
  router.use(requireAuth(environment), requireRole('admin'));
  router.post('/', ...csrfProtection(environment), validateRequest({ body: inviteCreateBodySchema }), asyncHandler(async (req, res) => {
    const result = await authService.createInvite(req.body, req.auth!.id, environment, transport, logger);
    res.status(201).json(result);
  }));
  router.get('/', validateRequest({ query: inviteListQuerySchema }), asyncHandler(async (req, res) => {
    const query = req.query as unknown as { page: number; pageSize: number; status?: string; search?: string };
    res.json(await authService.listInvites(query.page, query.pageSize, query.status, query.search));
  }));
  router.post('/:id/revoke', ...csrfProtection(environment), validateRequest({ params: tokenIdParamsSchema }), asyncHandler(async (req, res) => {
    await authService.revokeInvite(String(req.params.id), req.auth!.id, logger);
    res.status(204).end();
  }));
  router.post('/:id/resend', ...csrfProtection(environment), validateRequest({ params: tokenIdParamsSchema }), asyncHandler(async (req, res) => {
    const result = await authService.resendInvite(String(req.params.id), req.auth!.id, environment, transport, logger);
    res.json(result);
  }));
  return router;
}
