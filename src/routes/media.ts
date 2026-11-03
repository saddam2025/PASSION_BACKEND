import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { mediaIdParamsSchema, mediaListQuerySchema } from '../shared/schemas/media';
import { MediaService } from '../services/mediaService';
import { createStorageDriver } from '../services/storageDriver';
import type { AuthActor } from '../types/express';

function uploadError(error: unknown, request: Request, response: Response, next: NextFunction) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return next(new ValidationError('حجم الملف أكبر من الحد المسموح.', [{ field: 'file', code: 'too_big' }]));
    return next(new ValidationError('ارفع ملف واحد في الحقل المخصص.', [{ field: 'file', code: error.code }]));
  }
  next(error);
}

export function mediaRouter(environment: AppEnvironment, logger: pino.Logger, mediaService = new MediaService(createStorageDriver(environment), logger, environment.RECEIPT_SIGNED_URL_SECONDS)) {
  const router = Router();
  const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }).single('file');
  const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } }).single('file');
  const actor = (request: Express.Request) => request.auth as AuthActor;
  const uploadLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, keyGenerator: (request) => request.auth?.id ?? request.ip ?? 'unknown', standardHeaders: 'draft-8', legacyHeaders: false });
  router.use(requireAuth(environment));
  const admin = requireRole('admin');
  router.post('/', admin, ...csrfProtection(environment), uploadLimit, (req, res, next) => imageUpload(req, res, (error) => error ? uploadError(error, req, res, next) : next()), asyncHandler(async (request, response) => {
    if (!request.file) throw new ValidationError('اختار صورة للرفع.', [{ field: 'file', code: 'required' }]);
    response.status(201).json(await mediaService.uploadImage({ buffer: request.file.buffer, originalname: request.file.originalname, size: request.file.size }, actor(request)));
  }));
  router.get('/', admin, validateRequest({ query: mediaListQuerySchema }), asyncHandler(async (request, response) => response.json(await mediaService.list(request.query as never, actor(request)))));
  router.get('/receipts/:id/url', validateRequest({ params: mediaIdParamsSchema }), asyncHandler(async (request, response) => response.json(await mediaService.receiptUrl(String(request.params.id), actor(request)))));
  router.post('/receipts', ...csrfProtection(environment), uploadLimit, (req, res, next) => receiptUpload(req, res, (error) => error ? uploadError(error, req, res, next) : next()), asyncHandler(async (request, response) => {
    if (!request.file) throw new ValidationError('اختار إيصال للرفع.', [{ field: 'file', code: 'required' }]);
    response.status(201).json(await mediaService.uploadReceipt({ buffer: request.file.buffer, originalname: request.file.originalname, size: request.file.size }, actor(request)));
  }));
  router.get('/:id', admin, validateRequest({ params: mediaIdParamsSchema }), asyncHandler(async (request, response) => response.json(await mediaService.get(String(request.params.id), actor(request)))));
  router.delete('/:id', admin, ...csrfProtection(environment), validateRequest({ params: mediaIdParamsSchema }), asyncHandler(async (request, response) => response.json(await mediaService.remove(String(request.params.id), actor(request)))));
  return router;
}
