import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { userIdParamsSchema, userPatchBodySchema, usersQuerySchema } from '../shared/schemas/authEndpoints';
import { usersService } from '../services/usersService';

export function usersRouter(environment: AppEnvironment, logger: pino.Logger) {
  const router = Router();
  router.use(requireAuth(environment), requireRole('admin'));
  router.get('/', validateRequest({ query: usersQuerySchema }), asyncHandler(async (req, res) => res.json(await usersService.list(req.query as never))));
  router.get('/:id', validateRequest({ params: userIdParamsSchema }), asyncHandler(async (req, res) => res.json({ user: await usersService.get(String(req.params.id)) })));
  router.patch('/:id', ...csrfProtection(environment), validateRequest({ params: userIdParamsSchema, body: userPatchBodySchema }), asyncHandler(async (req, res) => res.json({ user: await usersService.patch(String(req.params.id), req.auth!.id, req.body, logger) })));
  router.post('/:id/deactivate', ...csrfProtection(environment), validateRequest({ params: userIdParamsSchema }), asyncHandler(async (req, res) => res.json({ user: await usersService.deactivate(String(req.params.id), req.auth!.id, logger) })));
  router.post('/:id/reactivate', ...csrfProtection(environment), validateRequest({ params: userIdParamsSchema }), asyncHandler(async (req, res) => res.json({ user: await usersService.reactivate(String(req.params.id), req.auth!.id, logger) })));
  return router;
}
