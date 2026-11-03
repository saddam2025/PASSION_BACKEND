import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { paymentListQuerySchema, paymentIdParamsSchema, voidPaymentBodySchema } from '../shared/schemas/staffRecords';
import { paymentsService } from '../services/paymentsService';

export function paymentsRouter(environment: AppEnvironment, logger: pino.Logger) {
  const router = Router();
  router.use(requireAuth(environment));
  router.get('/', requirePermission('viewPayments'), validateRequest({ query: paymentListQuerySchema }), asyncHandler(async (request, response) => {
    response.json(await paymentsService.list(request.query as never, request.auth!));
  }));
  router.post('/:id/void', ...csrfProtection(environment), requirePermission('recordPayments'), validateRequest({ params: paymentIdParamsSchema, body: voidPaymentBodySchema }), asyncHandler(async (request, response) => {
    response.json(await paymentsService.void(String(request.params.id), request.body.reason, request.auth!, logger));
  }));
  return router;
}
