import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../config/env';

describe('BE-1 environment validation', () => {
  it('reports missing required variables by name', () => {
    expect(() => parseEnvironment({})).toThrow(/MONGODB_URI/);
    expect(() => parseEnvironment({})).toThrow(/ACCESS_TOKEN_SECRET/);
  });

  it('rejects malformed MongoDB connection strings clearly', () => {
    expect(() => parseEnvironment({
      NODE_ENV: 'test',
      PORT: '4000',
      MONGODB_URI: 'mongodb://',
      ACCESS_TOKEN_SECRET: 'access-secret-for-integration-tests-only-0001',
      REFRESH_TOKEN_SECRET: 'refresh-secret-for-integration-tests-only-0002',
      COOKIE_DOMAIN: 'localhost',
      COOKIE_SECURE: 'false',
      CORS_ORIGINS: 'http://localhost:5173',
      APP_BASE_URL: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
    })).toThrow(/MONGODB_URI: Must be a valid/);
  });
});
