import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { notificationIdParamsSchema, notificationListQuerySchema } from '../shared/schemas/staffRecords';
import { staffRecordsService } from '../services/staffRecordsService';

export function notificationsRouter(environment: AppEnvironment, logger: pino.Logger) {
  const router = Router();
  router.use(requireAuth(environment));
  router.get('/', validateRequest({ query: notificationListQuerySchema }), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.listNotifications(request.auth!, request.query as never));
  }));
  router.get('/unread-count', asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.unreadNotificationCount(request.auth!));
  }));
  router.post('/read-all', ...csrfProtection(environment), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.markAllNotificationsRead(request.auth!, logger));
  }));
  router.post('/:id/read', ...csrfProtection(environment), validateRequest({ params: notificationIdParamsSchema }), asyncHandler(async (request, response) => {
    response.json(await staffRecordsService.markNotificationRead(String(request.params.id), request.auth!, logger));
  }));
  return router;
}
