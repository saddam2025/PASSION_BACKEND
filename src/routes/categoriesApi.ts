/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { categoryCreateSchema, categoryPatchSchema, categoryIdParamsSchema, categoryReorderSchema } from '../shared/schemas/categoriesApi';
import { categoriesService } from '../services/categoriesApiService';
import type { AuthActor } from '../types/express';
export function categoriesApiRouter(environment: AppEnvironment, logger: pino.Logger) {
 const router = Router(); const admin = [requireAuth(environment), requireRole('admin'), ...csrfProtection(environment)];
 router.get('/', asyncHandler(async (_req,res) => res.json({ items: await categoriesService.list() })));
 router.get('/public', asyncHandler(async (_req,res) => res.json({ items: await categoriesService.list() })));
 router.post('/reorder', ...admin, validateRequest({ body: categoryReorderSchema }), asyncHandler(async (req,res) => res.json({ items: await categoriesService.reorder((req.body as any).ids, (req.auth as AuthActor).id, logger) })));
 router.post('/', ...admin, validateRequest({ body: categoryCreateSchema }), asyncHandler(async (req,res) => { const b=req.body as any; res.status(201).json(await categoriesService.create(b.name,b.slug,(req.auth as AuthActor).id,logger)); }));
 router.patch('/:id', ...admin, validateRequest({ params: categoryIdParamsSchema, body: categoryPatchSchema }), asyncHandler(async (req,res) => res.json(await categoriesService.update(String(req.params.id),req.body as any,(req.auth as AuthActor).id,logger))));
 router.delete('/:id', ...admin, validateRequest({ params: categoryIdParamsSchema }), asyncHandler(async (req,res) => res.json(await categoriesService.remove(String(req.params.id),(req.auth as AuthActor).id,logger))));
 return router;
}
