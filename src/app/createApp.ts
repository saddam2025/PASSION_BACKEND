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
import type { MountedRouteRouter } from '../security/routeInventory';

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
    .replace(/([?&](?:token|code|email|phone|name)=)[^&]*/gi, '$1[REDACTED]');
}

export function createApp(environment: AppEnvironment, options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? createLogger(environment.LOG_LEVEL);
  const allowedOrigins = new Set(environment.CORS_ORIGINS);
  app.set('env', environment.NODE_ENV);
  app.set('trust proxy', environment.TRUST_PROXY_HOPS);

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

  const emailTransport = options.emailTransport ?? createEmailTransport(environment);
  const routeRouters: MountedRouteRouter[] = [
    { path: '/api/v1', router: healthRouter },
    { path: '/api/v1/auth', router: authRouter(environment, logger, emailTransport) },
    { path: '/api/v1/users', router: usersRouter(environment, logger) },
    { path: '/api/v1/invites', router: invitesRouter(environment, logger, emailTransport) },
    { path: '/api/v1/public', router: publicRegistrationsRouter(environment, logger, options.publicRegistrationRateLimits) },
    { path: '/api/v1/public/courses', router: publicCoursesRouter() },
    { path: '/api/v1/enrollments', router: enrollmentsRouter(environment, logger) },
    { path: '/api/v1/leads', router: leadsRouter(environment) },
    { path: '/api/v1/notifications', router: notificationsRouter(environment, logger) },
    { path: '/api/v1/payments', router: paymentsRouter(environment, logger) },
    { path: '/api/v1/media', router: mediaRouter(environment, logger) },
    { path: '/api/v1/settings', router: settingsApiRouter(environment, logger) },
    { path: '/api/v1/categories', router: categoriesApiRouter(environment, logger) },
    { path: '/api/v1/audit', router: auditApiRouter(environment, logger) },
    { path: '/api/v1/courses', router: coursesRouter(environment) },
    { path: '/api/v1/admin/overview', router: overviewRouter(environment) },
    { path: '/api/v1/seo', router: seoRouter(environment) },
  ];
  app.locals.securityRouteRouters = routeRouters;
  for (const mount of routeRouters) app.use(mount.path, mount.router);
  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
