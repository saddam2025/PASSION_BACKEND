import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { validateRequest } from '../middleware/validation';
import { z } from 'zod';

const environment = parseEnvironment({
  NODE_ENV: 'test',
  PORT: '4000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'access-secret-for-http-tests-only-0000001',
  REFRESH_TOKEN_SECRET: 'refresh-secret-for-http-tests-only-0002',
  COOKIE_DOMAIN: 'localhost',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: 'http://localhost:5173',
  APP_BASE_URL: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
});

const app = createApp(environment, { logger: createLogger('silent') });

describe('BE-1 HTTP foundation', () => {
  it('serves liveness without requiring MongoDB', async () => {
    await request(app).get('/api/v1/health').expect(200, { status: 'ok' });
  });

  it('returns request IDs and the standard envelope for an unknown path', async () => {
    const response = await request(app).get('/api/v1/no-such-route').expect(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('maps malformed and oversized JSON to 400 and 413 envelopes', async () => {
    const malformed = await request(app)
      .post('/api/v1/example')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(malformed.body.error.code).toBe('MALFORMED_JSON');

    const smallApp = createApp(environment, { logger: createLogger('silent'), jsonLimit: '32b' });
    const oversized = await request(smallApp)
      .post('/api/v1/example')
      .send({ content: 'x'.repeat(100) })
      .expect(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns Zod details and strips unknown request keys', async () => {
    const validationApp = createApp(environment, {
      logger: createLogger('silent'),
      registerRoutes: (target: Express) => {
        target.post(
          '/api/v1/validation-probe',
          validateRequest({ body: z.object({ name: z.string().min(2) }) }),
          (requestObject, response) => response.json(requestObject.body),
        );
      },
    });
    const invalid = await request(validationApp)
      .post('/api/v1/validation-probe')
      .send({ name: 'x' })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.details[0].path).toEqual(['name']);
    const valid = await request(validationApp)
      .post('/api/v1/validation-probe')
      .send({ name: 'Aya', ignored: true })
      .expect(200);
    expect(valid.body).toEqual({ name: 'Aya' });
  });

  it('rewrites Mongo operator keys before a route sees request data', async () => {
    const sanitizeApp = createApp(environment, {
      logger: createLogger('silent'),
      registerRoutes: (target: Express) => {
        target.post(
          '/api/v1/sanitize-probe',
          validateRequest({ body: z.object({ filter: z.record(z.unknown()) }) }),
          (requestObject, response) => response.json(requestObject.body),
        );
      },
    });
    const response = await request(sanitizeApp)
      .post('/api/v1/sanitize-probe')
      .send({ filter: { $gt: 'unsafe' } })
      .expect(200);
    expect(response.body).toEqual({ filter: { _gt: 'unsafe' } });
  });

  it('sets security headers, allows configured CORS origins and rejects others', async () => {
    const allowed = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['content-security-policy']).toContain("default-src 'self'");
    expect(allowed.headers['strict-transport-security']).toContain('max-age=15552000');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://not-allowed.example')
      .expect(403);
    expect(denied.body.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('uses the standard envelope when global rate limiting is exceeded', async () => {
    const limitedApp = createApp(environment, { logger: createLogger('silent'), rateLimitMax: 2 });
    await request(limitedApp).get('/api/v1/health').expect(200);
    await request(limitedApp).get('/api/v1/health').expect(200);
    const response = await request(limitedApp).get('/api/v1/health').expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('keys rate limits by X-Forwarded-For only when TRUST_PROXY_HOPS is enabled', async () => {
    const noProxyTrust = createApp(environment, { logger: createLogger('silent'), rateLimitMax: 1 });
    await request(noProxyTrust).get('/api/v1/health').set('X-Forwarded-For', '203.0.113.10').expect(200);
    await request(noProxyTrust).get('/api/v1/health').set('X-Forwarded-For', '198.51.100.11').expect(429);

    const trustedEnvironment = parseEnvironment({
      NODE_ENV: 'test', PORT: '4000', TRUST_PROXY_HOPS: '1',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0',
      ACCESS_TOKEN_SECRET: 'access-secret-for-http-tests-only-0000001',
      REFRESH_TOKEN_SECRET: 'refresh-secret-for-http-tests-only-0002',
      COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173',
      APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
    });
    const trustedProxy = createApp(trustedEnvironment, { logger: createLogger('silent'), rateLimitMax: 1 });
    await request(trustedProxy).get('/api/v1/health').set('X-Forwarded-For', '203.0.113.10').expect(200);
    await request(trustedProxy).get('/api/v1/health').set('X-Forwarded-For', '198.51.100.11').expect(200);
    await request(trustedProxy).get('/api/v1/health').set('X-Forwarded-For', '203.0.113.10').expect(429);
  });

  it('returns a readiness-unavailable error when MongoDB is disconnected', async () => {
    const response = await request(app).get('/api/v1/health/ready').expect(503);
    expect(response.body.error).toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is not ready',
      requestId: response.headers['x-request-id'],
    });
  });

  it('prints names of missing environment variables in the fail-fast message', () => {
    expect(() => parseEnvironment({})).toThrow(/MONGODB_URI/);
    expect(() => parseEnvironment({})).toThrow(/ACCESS_TOKEN_SECRET/);
    expect(() => parseEnvironment({})).toThrow(/REFRESH_TOKEN_SECRET/);
  });
});
