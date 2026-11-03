/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { settingsPatchBodySchema, settingsSectionSchema } from '../shared/schemas/settingsApi';
import { readSettings, publicSettings, staffSettings, patchSettings } from '../services/settingsApiService';
import { MediaService } from '../services/mediaService';
import { createStorageDriver } from '../services/storageDriver';
import { ValidationError } from '../lib/errors';
import type { AuthActor } from '../types/express';
export function settingsApiRouter(environment: AppEnvironment, logger: pino.Logger) {
 const router = Router(); const media = new MediaService(createStorageDriver(environment), logger, environment.RECEIPT_SIGNED_URL_SECONDS);
 router.get('/public', asyncHandler(async (_req,res) => { const value = publicSettings(await readSettings()); res.set('Cache-Control','public, max-age=300, stale-while-revalidate=60'); res.json(value); }));
 router.get('/', requireAuth(environment), requirePermission('viewSettings'), asyncHandler(async (_req,res) => res.json(staffSettings(await readSettings()))));
 router.patch('/', requireAuth(environment), requireRole('admin'), ...csrfProtection(environment), validateRequest({ body: settingsPatchBodySchema }), asyncHandler(async (req,res) => { const body = req.body as any; const parsed = settingsSectionSchema.safeParse({ section: body.section, value: body.value }); if (!parsed.success) throw new ValidationError('راجع بيانات القسم.', parsed.error.issues); res.json(await patchSettings({ expectedVersion: body.expectedVersion, ...parsed.data }, (req.auth as AuthActor).id, media, logger)); }));
 return router;
}
