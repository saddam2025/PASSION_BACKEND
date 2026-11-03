import { Router } from 'express';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { seoService } from '../services/seoService';

export function seoRouter(environment: AppEnvironment) {
  const router = Router();
  const unavailable = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الصفحة غير موجودة</title></head><body><h1>الصفحة غير موجودة</h1></body></html>';
  router.get('/courses/:slug', asyncHandler(async (req, res) => {
    const slug = String(req.params.slug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { res.status(404).type('html').send(unavailable); return; }
    const page = await seoService.coursePage(slug, environment);
    if (!page) { res.status(404).type('html').set('Cache-Control', 'public, max-age=60').send(unavailable); return; }
    res.status(200).type('html').set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=300', 'X-Robots-Tag': page.noindex ? 'noindex, nofollow' : 'index, follow', 'X-Content-Type-Options': 'nosniff' }).send(page.html);
  }));
  router.get('/sitemap.xml', asyncHandler(async (_req, res) => res.type('application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(await seoService.sitemap(environment))));
  router.get('/robots.txt', (_req, res) => res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(seoService.robots(environment)));
  return router;
}
