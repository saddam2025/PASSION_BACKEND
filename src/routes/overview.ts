import { Router } from 'express';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { parseOverviewQuery } from '../shared/schemas/overview';
import { overviewService } from '../services/overviewService';
import { overviewChartsService } from '../services/overviewChartsService';

export function overviewRouter(environment: AppEnvironment) {
  const router = Router();
  const admin = [requireAuth(environment), requireRole('admin')];
  router.get('/', ...admin, asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store').json(await overviewService.get(parseOverviewQuery(request.query)));
  }));
  router.get('/charts', ...admin, asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store').json(await overviewChartsService.get(parseOverviewQuery(request.query)));
  }));
  return router;
}
