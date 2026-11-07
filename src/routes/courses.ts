import { Router } from 'express';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { courseIdParamsSchema, courseListQuerySchema, publicCourseListQuerySchema as zPublicCourseListQuerySchema, checkCourseSlugQuerySchema, createCourseBodySchema, duplicateCourseBodySchema, featuredCourseBodySchema, publishCourseBodySchema, saveCourseDraftBodySchema, softDeleteBodySchema } from '../shared/schemas/coursesApi';
import { coursesService, courseEtag } from '../services/coursesService';
import type { AuthActor } from '../types/express';
import { NotFoundError } from '../lib/errors';

const noCache = 'private, no-store';
export function coursesRouter(environment: AppEnvironment) {
  const router = Router();
  const admin = [requireAuth(environment), requireRole('admin')];
  router.use(...admin);
  router.get('/', validateRequest({ query: courseListQuerySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json(await coursesService.list(req.query as never))));
  router.get('/check-slug', validateRequest({ query: checkCourseSlugQuerySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json(await coursesService.checkSlug(String(req.query.slug), req.query.exceptId as string | undefined))));
  router.post('/', ...csrfProtection(environment), validateRequest({ body: createCourseBodySchema }), asyncHandler(async (req, res) => res.status(201).set('Cache-Control', noCache).json({ course: await coursesService.create(req.body, req.auth as AuthActor) })));
  router.post('/:id/duplicate', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: duplicateCourseBodySchema }), asyncHandler(async (req, res) => res.status(201).set('Cache-Control', noCache).json({ course: await coursesService.duplicate(String(req.params.id), req.body, req.auth as AuthActor) })));
  router.patch('/:id/featured', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: featuredCourseBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.setFeatured(String(req.params.id), req.body.featured, req.auth as AuthActor) })));
  router.get('/:id', validateRequest({ params: courseIdParamsSchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.get(String(req.params.id)) })));
  router.put('/:id/draft', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: saveCourseDraftBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.saveDraft(String(req.params.id), req.body.expectedVersion, req.body.draft, req.auth as AuthActor) })));
  router.post('/:id/publish', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: publishCourseBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.publish(String(req.params.id), req.body.expectedVersion, req.auth as AuthActor) })));
  router.post('/:id/unpublish', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: publishCourseBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.changeStatus(String(req.params.id), req.body.expectedVersion, 'draft', req.auth as AuthActor, 'course_unpublished') })));
  router.post('/:id/archive', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: publishCourseBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.changeStatus(String(req.params.id), req.body.expectedVersion, 'archived', req.auth as AuthActor, 'course_archived') })));
  router.post('/:id/unarchive', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: publishCourseBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json({ course: await coursesService.changeStatus(String(req.params.id), req.body.expectedVersion, 'draft', req.auth as AuthActor, 'course_unarchived') })));
  router.delete('/:id', ...csrfProtection(environment), validateRequest({ params: courseIdParamsSchema, body: softDeleteBodySchema }), asyncHandler(async (req, res) => res.set('Cache-Control', noCache).json(await coursesService.remove(String(req.params.id), req.body.expectedVersion, req.auth as AuthActor))));
  return router;
}

export function publicCoursesRouter() {
  const router = Router();
  const cache = 'public, max-age=60, stale-while-revalidate=300';
  router.get('/', validateRequest({ query: zPublicCourseListQuerySchema }), asyncHandler(async (req, res) => {
    const { q, category, featured, page, pageSize } = req.query as unknown as { q?: string; category?: string; featured?: 'true' | 'false'; page: number; pageSize: number };
    const value = await coursesService.publicList({ page, pageSize, ...(q ? { q } : {}), ...(category ? { category } : {}), ...(featured ? { featured } : {}) }); const etag = courseEtag(value);
    res.set({ 'Cache-Control': cache, ETag: etag, 'X-Content-Type-Options': 'nosniff' });
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    res.json(value);
  }));
  router.get('/:slug', asyncHandler(async (req, res) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(req.params.slug))) throw new NotFoundError('الكورس ده مش موجود.');
    const value = await coursesService.publicBySlug(String(req.params.slug));
    if (!value) throw new NotFoundError('الكورس ده مش موجود.');
    if ('redirect' in value) { res.set('Cache-Control', cache).json({ status: 'redirect', slug: value.slug }); return; }
    const etag = courseEtag(value); res.set({ 'Cache-Control': cache, ETag: etag, 'X-Content-Type-Options': 'nosniff' });
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    res.json({ status: 'ok', ...value });
  }));
  return router;
}
