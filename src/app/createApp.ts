import { randomUUID } from 'node:crypto';
import cors from 'cors';
import cookieParserMiddleware from 'cookie-parser';
import express, { type Express } from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import pinoHttp from 'pino-http';
import type pino from 'pino';
import type { AppEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { errorHandler } from '../middleware/errorHandler';
import { notFoundHandler } from '../middleware/notFound';
import { requestIdMiddleware } from '../middleware/requestId';
import { RateLimitError } from '../lib/errors';
import { healthRouter } from '../routes/health';
import { authRouter } from '../routes/auth';
import { usersRouter } from '../routes/users';
import { invitesRouter } from '../routes/invites';
import { publicRegistrationsRouter, type PublicRegistrationRateLimits } from '../routes/publicRegistrations';
import { enrollmentsRouter } from '../routes/enrollments';
import { leadsRouter } from '../routes/leads';
import { notificationsRouter } from '../routes/notifications';
import { paymentsRouter } from '../routes/payments';
import { createEmailTransport } from '../services/emailTransport';
import { mediaRouter } from '../routes/media';
import type { EmailTransport } from '../services/emailTransport';
import { settingsApiRouter } from '../routes/settingsApi';
import { categoriesApiRouter } from '../routes/categoriesApi';
import { auditApiRouter } from '../routes/auditApi';
import { coursesRouter, publicCoursesRouter } from '../routes/courses';
import { overviewRouter } from '../routes/overview';
import { seoRouter } from '../routes/seo';

export interface AppOptions {
  logger?: pino.Logger;
  jsonLimit?: string;
  rateLimitMax?: number;
  publicRegistrationRateLimits?: PublicRegistrationRateLimits;
  emailTransport?: EmailTransport;
  registerRoutes?: (app: Express) => void;
}

function safeRequestUrl(value: string): string {
  return value
    .replace(/\/(invites|invite|reset-password)\/[^/?]+/gi, '/$1/[REDACTED]')
    .replace(/([?&](?:token|code)=)[^&]+/gi, '$1[REDACTED]');
}

export function createApp(environment: AppEnvironment, options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? createLogger(environment.LOG_LEVEL);
  const allowedOrigins = new Set(environment.CORS_ORIGINS);
  app.set('env', environment.NODE_ENV);
  app.set('trust proxy', false);

  app.use(requestIdMiddleware);
  app.use((request, response, next) => {
    response.locals.logger = logger;
    next();
  });
  app.use(pinoHttp({
    logger,
    genReqId: (request) => (request as typeof request & { requestId?: string }).requestId ?? randomUUID(),
    serializers: {
      req(request) {
        return {
          id: request.id,
          method: request.method,
          url: safeRequestUrl(request.url ?? ''),
          remoteAddress: request.remoteAddress,
        };
      },
    },
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: environment.NODE_ENV === 'production' ? [] : null,
      },
    },
    hsts: { maxAge: 15_552_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else {
        const error = new Error('Origin is not allowed');
        error.name = 'CorsOriginError';
        callback(error);
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token', 'Idempotency-Key'],
    maxAge: 600,
  }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.rateLimitMax ?? 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) => next(new RateLimitError()),
  }));
  app.use(express.json({ limit: options.jsonLimit ?? '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: options.jsonLimit ?? '100kb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: options.jsonLimit ?? '100kb' }));
  app.use(express.text({ type: 'text/plain', limit: options.jsonLimit ?? '100kb' }));
  app.use(cookieParserMiddleware());
  app.use(hpp());
  app.use(mongoSanitize({ replaceWith: '_' }));

  app.use('/api/v1', healthRouter);
  const emailTransport = options.emailTransport ?? createEmailTransport(environment);
  app.use('/api/v1/auth', authRouter(environment, logger, emailTransport));
  app.use('/api/v1/users', usersRouter(environment, logger));
  app.use('/api/v1/invites', invitesRouter(environment, logger, emailTransport));
  app.use('/api/v1/public', publicRegistrationsRouter(environment, logger, options.publicRegistrationRateLimits));
  app.use('/api/v1/public/courses', publicCoursesRouter());
  app.use('/api/v1/enrollments', enrollmentsRouter(environment, logger));
  app.use('/api/v1/leads', leadsRouter(environment));
  app.use('/api/v1/notifications', notificationsRouter(environment, logger));
  app.use('/api/v1/payments', paymentsRouter(environment, logger));
  app.use('/api/v1/media', mediaRouter(environment, logger));
  app.use('/api/v1/settings', settingsApiRouter(environment, logger));
  app.use('/api/v1/categories', categoriesApiRouter(environment, logger));
  app.use('/api/v1/audit', auditApiRouter(environment, logger));
  app.use('/api/v1/courses', coursesRouter(environment));
  app.use('/api/v1/admin/overview', overviewRouter(environment));
  app.use('/api/v1/seo', seoRouter(environment));
  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
