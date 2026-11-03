import { createHash } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { RateLimitError, ValidationError } from '../lib/errors';
import { requireSameOrigin } from '../middleware/csrf';
import { publicRegistrationBodySchema, registrationReferenceParamsSchema } from '../shared/schemas/publicRegistration';
import { getPublicRegistrationConfirmation, submitPublicRegistration } from '../services/publicRegistrationsService';

export interface PublicRegistrationRateLimits { perIp?: number; perEmailHash?: number; confirmationPerIp?: number }

function publicRegistrationValidation(): RequestHandler {
  return (request, _response, next) => {
    const result = publicRegistrationBodySchema.safeParse(request.body);
    if (!result.success) return next(new ValidationError('راجع بيانات التسجيل وحاول تاني.', result.error.issues.map(({ path }) => ({ field: path.join('.'), message: 'راجع الحقل ده.' }))));
    request.body = result.data;
    next();
  };
}

function hashedEmailKey(request: Request): string {
  const body = request.body ?? {};
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers as Record<string, unknown> : {};
  const email = typeof body.email === 'string' ? body.email : typeof answers.email === 'string' ? answers.email : '';
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function limiter(limit: number, keyGenerator?: (request: Request) => string) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_request, _response, next) => next(new RateLimitError('عدد المحاولات كبير. جرّب تاني بعد شوية.')),
  });
}

export function publicRegistrationsRouter(environment: AppEnvironment, logger: pino.Logger, limits: PublicRegistrationRateLimits = {}) {
  const router = Router();
  const perIpRegistrationLimit = limiter(limits.perIp ?? 100);
  const perEmailHashLimit = limiter(limits.perEmailHash ?? 20, hashedEmailKey);
  const confirmationLimit = limiter(limits.confirmationPerIp ?? 30);

  router.post('/registrations', requireSameOrigin(environment), perIpRegistrationLimit, perEmailHashLimit, publicRegistrationValidation(), asyncHandler(async (request, response) => {
    const result = await submitPublicRegistration(request.body as ReturnType<typeof publicRegistrationBodySchema.parse>, environment, logger);
    response.status(result.created ? 201 : 200).json({ reference: result.reference, status: result.status });
  }));

  router.get('/registrations/:reference', confirmationLimit, asyncHandler(async (request, response, next) => {
    const params = registrationReferenceParamsSchema.safeParse(request.params);
    if (!params.success) return next(new ValidationError('الرقم المرجعي غير صحيح.'));
    response.json(await getPublicRegistrationConfirmation(params.data.reference));
  }));

  return router;
}
