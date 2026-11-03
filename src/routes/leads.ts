import { Router } from 'express';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { leadIdParamsSchema } from '../shared/schemas/staffRecords';
import { staffRecordsService } from '../services/staffRecordsService';

export function leadsRouter(environment: AppEnvironment) {
  const router = Router();
  router.use(requireAuth(environment), requirePermission('viewLeads'));
  router.get('/:id', validateRequest({ params: leadIdParamsSchema }), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.getLead(String(request.params.id)));
  }));
  return router;
}
