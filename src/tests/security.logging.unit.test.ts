import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import type { Express } from 'express';

function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  return { chunks, stream };
}

const environment = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'security-logging-access-secret-000000001', REFRESH_TOKEN_SECRET: 'security-logging-refresh-secret-00000002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'info',
});
const productionEnvironment = parseEnvironment({
  NODE_ENV: 'production', PORT: '8080', MONGODB_URI: 'mongodb://produser:production-database-password-32-characters@mongo.example.test:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'access-prod-random-secret-8db5c762f8a6c410', REFRESH_TOKEN_SECRET: 'refresh-prod-random-secret-42a7d30d9fcd8b72',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'lax', CORS_ORIGINS: 'https://passion.example.test', APP_BASE_URL: 'https://passion.example.test', LOG_LEVEL: 'silent',
  R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'r2-access-key-id-32-character-value', R2_SECRET_ACCESS_KEY: 'r2-secret-access-key-32-character-value',
  R2_PUBLIC_BUCKET: 'public', R2_PRIVATE_BUCKET: 'private', R2_PUBLIC_BASE_URL: 'https://media.example.test',
});

describe('production log privacy', () => {
  it('redacts credentials, tokens, cookies, authorization, email and phone fields', () => {
    const output = captureStream();
    const logger = createLogger('info', output.stream as never);
    logger.info({ password: 'private-password', token: 'private-token', cookie: 'private-cookie', authorization: 'private-auth', email: 'private@example.test', phone: '+201000000000', context: { lead: { email: 'nested@example.test', phone: '+201111111111' } } }, 'privacy check');
    const line = output.chunks.join('');
    for (const value of ['private-password', 'private-token', 'private-cookie', 'private-auth', 'private@example.test', '+201000000000', 'nested@example.test', '+201111111111']) expect(line).not.toContain(value);
    expect(line.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('logs public registration requests without request body, IP, email, or phone values', async () => {
    const output = captureStream();
    const app = createApp(environment, { logger: createLogger('info', output.stream as never) });
    await request(app).post('/api/v1/public/registrations?email=private%40example.test&phone=%2B201000000000')
      .set('Origin', 'http://localhost:5173')
      .send({ fullName: 'Private Name', email: 'private@example.test', phone: '+201000000000' }).expect(422);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const line = output.chunks.join('');
    for (const value of ['private@example.test', '+201000000000', 'Private Name', '127.0.0.1']) expect(line).not.toContain(value);
    expect(line).toContain('[REDACTED]');
  });

  it('sets production HSTS and keeps unhandled error responses free of stack and internals', async () => {
    const app = createApp(productionEnvironment, {
      registerRoutes: (target: Express) => target.get('/api/v1/security-probe', () => { throw new Error('internal database detail'); }),
    });
    const response = await request(app).get('/api/v1/security-probe').expect(500);
    expect(response.headers['strict-transport-security']).toContain('max-age=15552000');
    expect(response.body.error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(response.body)).not.toContain('internal database detail');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
});
