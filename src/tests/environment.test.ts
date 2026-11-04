import { describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../config/env';
import { createApp } from '../app/createApp';
import { setAuthCookies } from '../services/authTokens';
import { createEmailTransport } from '../services/emailTransport';

const productionEnvironment = (overrides: Record<string, string> = {}) => ({
  NODE_ENV: 'production', PORT: '8080', TRUST_PROXY_HOPS: '1',
  MONGODB_URI: 'mongodb://produser:production-database-password-32-characters@mongo.example.test:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'access-prod-random-secret-8db5c762f8a6c410',
  REFRESH_TOKEN_SECRET: 'refresh-prod-random-secret-42a7d30d9fcd8b72',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'lax',
  CORS_ORIGINS: 'https://passion.example.test', APP_BASE_URL: 'https://passion.example.test', LOG_LEVEL: 'info',
  R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'r2-access-key-id-32-character-value', R2_SECRET_ACCESS_KEY: 'r2-secret-access-key-32-character-value',
  R2_PUBLIC_BUCKET: 'public', R2_PRIVATE_BUCKET: 'private', R2_PUBLIC_BASE_URL: 'https://media.example.test',
  ...overrides,
});

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

  it('accepts secure cross-site production cookies and an explicit Railway proxy hop count', () => {
    const parsed = parseEnvironment({
      NODE_ENV: 'production',
      PORT: '8080',
      TRUST_PROXY_HOPS: '1',
      MONGODB_URI: 'mongodb://produser:production-database-password-32-characters@mongo.example.test:27017/passion?replicaSet=rs0',
      ACCESS_TOKEN_SECRET: 'access-secret-value-that-is-at-least-32-characters',
      REFRESH_TOKEN_SECRET: 'refresh-secret-value-that-is-at-least-32-characters',
      COOKIE_DOMAIN: 'localhost',
      COOKIE_SECURE: 'true',
      COOKIE_SAME_SITE: 'none',
      CORS_ORIGINS: 'https://passion-frontend.vercel.app',
      APP_BASE_URL: 'https://passion-frontend.vercel.app',
      LOG_LEVEL: 'info',
      R2_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'r2-access-key-id-32-character-value',
      R2_SECRET_ACCESS_KEY: 'r2-secret-access-key-32-character-value',
      R2_PUBLIC_BUCKET: 'public',
      R2_PRIVATE_BUCKET: 'private',
      R2_PUBLIC_BASE_URL: 'https://media.example.test',
    });
    expect(parsed.COOKIE_SAME_SITE).toBe('none');
    expect(parsed.TRUST_PROXY_HOPS).toBe(1);
    expect(createApp(parsed).get('trust proxy')).toBe(1);
    const cookie = vi.fn();
    setAuthCookies({ cookie } as never, parsed, 'access-token', 'refresh-token');
    expect(cookie).toHaveBeenNthCalledWith(1, '__Host-access', 'access-token', expect.objectContaining({ secure: true, sameSite: 'none', path: '/', httpOnly: true }));
    expect(cookie).toHaveBeenNthCalledWith(2, '__Host-refresh', 'refresh-token', expect.objectContaining({ secure: true, sameSite: 'none', path: '/', httpOnly: true }));
  });

  it('rejects cross-site cookies without Secure', () => {
    expect(() => parseEnvironment({
      NODE_ENV: 'development',
      PORT: '4000',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0',
      ACCESS_TOKEN_SECRET: 'access-secret-value-that-is-at-least-32-characters',
      REFRESH_TOKEN_SECRET: 'refresh-secret-value-that-is-at-least-32-characters',
      COOKIE_DOMAIN: 'localhost',
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'none',
      CORS_ORIGINS: 'http://localhost:5173',
      APP_BASE_URL: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
    })).toThrow(/COOKIE_SECURE: Must be true when COOKIE_SAME_SITE is none/);
  });

  it.each([
    ['MONGODB_URI', { MONGODB_URI: 'mongodb://127.0.0.1:27017/passion' }, /MONGODB_URI/],
    ['MONGODB_URI credentials', { MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0' }, /MONGODB_URI/],
    ['MONGODB_URI password length', { MONGODB_URI: 'mongodb://produser:short@mongo.example.test:27017/passion?replicaSet=rs0' }, /MONGODB_URI/],
    ['MONGODB_URI password example value', { MONGODB_URI: 'mongodb://produser:replace-with-a-random-secret-at-least-32-characters@mongo.example.test:27017/passion?replicaSet=rs0' }, /MONGODB_URI/],
    ['APP_BASE_URL', { APP_BASE_URL: 'http://passion.example.test' }, /APP_BASE_URL/],
    ['CORS_ORIGINS wildcard', { CORS_ORIGINS: '*' }, /CORS_ORIGINS/],
    ['CORS_ORIGINS insecure origin', { CORS_ORIGINS: 'http://passion.example.test' }, /CORS_ORIGINS/],
    ['COOKIE_SECURE', { COOKIE_SECURE: 'false' }, /COOKIE_SECURE/],
    ['ACCESS_TOKEN_SECRET too short', { ACCESS_TOKEN_SECRET: 'short' }, /ACCESS_TOKEN_SECRET/],
    ['REFRESH_TOKEN_SECRET too short', { REFRESH_TOKEN_SECRET: 'short' }, /REFRESH_TOKEN_SECRET/],
    ['ACCESS_TOKEN_SECRET example value', { ACCESS_TOKEN_SECRET: 'replace-with-a-random-secret-at-least-32-characters' }, /ACCESS_TOKEN_SECRET/],
    ['REFRESH_TOKEN_SECRET example value', { REFRESH_TOKEN_SECRET: 'replace-with-a-different-random-secret-at-least-32-characters' }, /REFRESH_TOKEN_SECRET/],
    ['R2_ACCESS_KEY_ID too short', { R2_ACCESS_KEY_ID: 'short' }, /R2_ACCESS_KEY_ID/],
    ['R2_ACCESS_KEY_ID example value', { R2_ACCESS_KEY_ID: 'replace-with-a-random-secret-at-least-32-characters' }, /R2_ACCESS_KEY_ID/],
    ['R2_SECRET_ACCESS_KEY example value', { R2_SECRET_ACCESS_KEY: 'replace-with-a-random-secret-at-least-32-characters' }, /R2_SECRET_ACCESS_KEY/],
    ['EMAIL_PROVIDER_API_KEY too short', { EMAIL_PROVIDER_API_KEY: 'short' }, /EMAIL_PROVIDER_API_KEY/],
    ['EMAIL_PROVIDER_API_KEY example value', { EMAIL_PROVIDER_API_KEY: 'replace-with-a-random-secret-at-least-32-characters' }, /EMAIL_PROVIDER_API_KEY/],
    ...(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BUCKET', 'R2_PRIVATE_BUCKET', 'R2_PUBLIC_BASE_URL'] as const)
      .map((key) => [`${key} required`, { [key]: '' }, new RegExp(key)] as [string, Record<string, string>, RegExp]),
  ])('rejects invalid production configuration for %s', (_name, overrides, expected) => {
    expect(() => parseEnvironment(productionEnvironment(overrides))).toThrow(expected);
  });

  it('uses no development email or console transport in production', async () => {
    const info = vi.fn();
    const transport = createEmailTransport(parseEnvironment(productionEnvironment()));
    await transport.sendInviteLink('private@example.test', 'https://private.example.test/invite/token', { info } as never);
    expect(info).not.toHaveBeenCalled();
  });
});
