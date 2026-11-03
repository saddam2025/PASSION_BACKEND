import { Router } from 'express';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { overviewQuerySchema } from '../shared/schemas/overview';
import { overviewService } from '../services/overviewService';

export function overviewRouter(environment: AppEnvironment) {
  const router = Router();
  router.get('/', requireAuth(environment), requireRole('admin'), validateRequest({ query: overviewQuerySchema }), asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store').json(await overviewService.get(request.query as never));
  }));
  return router;
}
