import { describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../config/env';
import { clearAuthCookies, setAuthCookies, setCsrfCookie } from '../services/authTokens';

const productionEnvironment = parseEnvironment({
  NODE_ENV: 'production',
  PORT: '8080',
  TRUST_PROXY_HOPS: '2',
  MONGODB_URI: 'mongodb://produser:production-database-password-32-characters@mongo.example.test:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'access-secret-value-that-is-at-least-32-characters',
  REFRESH_TOKEN_SECRET: 'refresh-secret-value-that-is-at-least-32-characters',
  COOKIE_DOMAIN: 'passion-frontend.vercel.app',
  COOKIE_SECURE: 'true',
  COOKIE_SAME_SITE: 'lax',
  CORS_ORIGINS: 'https://passion-frontend.vercel.app',
  APP_BASE_URL: 'https://passion-frontend.vercel.app',
  LOG_LEVEL: 'silent',
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'r2-access-key-id-32-character-value',
  R2_SECRET_ACCESS_KEY: 'r2-secret-access-key-32-character-value',
  R2_PUBLIC_BUCKET: 'public',
  R2_PRIVATE_BUCKET: 'private',
  R2_PUBLIC_BASE_URL: 'https://media.example.test',
});

describe('production __Host cookie attributes', () => {
  it('keeps auth, CSRF, and clearing cookies Secure, host-only, and at Path=/', () => {
    const cookie = vi.fn();
    setAuthCookies({ cookie } as never, productionEnvironment, 'access-token', 'refresh-token');
    expect(cookie).toHaveBeenNthCalledWith(1, '__Host-access', 'access-token', expect.objectContaining({ secure: true, sameSite: 'lax', path: '/', httpOnly: true }));
    expect(cookie).toHaveBeenNthCalledWith(2, '__Host-refresh', 'refresh-token', expect.objectContaining({ secure: true, sameSite: 'lax', path: '/', httpOnly: true }));
    expect(cookie.mock.calls[0]?.[2]).not.toHaveProperty('domain');
    expect(cookie.mock.calls[1]?.[2]).not.toHaveProperty('domain');

    const csrfCookie = vi.fn();
    setCsrfCookie({ cookie: csrfCookie } as never, productionEnvironment, 'csrf-token');
    expect(csrfCookie).toHaveBeenCalledWith('__Host-csrf', 'csrf-token', expect.objectContaining({ secure: true, sameSite: 'lax', path: '/', httpOnly: false }));
    expect(csrfCookie.mock.calls[0]?.[2]).not.toHaveProperty('domain');

    const clearCookie = vi.fn();
    clearAuthCookies({ clearCookie } as never, productionEnvironment);
    expect(clearCookie).toHaveBeenNthCalledWith(1, '__Host-access', expect.objectContaining({ secure: true, path: '/', httpOnly: true }));
    expect(clearCookie).toHaveBeenNthCalledWith(2, '__Host-refresh', expect.objectContaining({ secure: true, path: '/', httpOnly: true }));
    expect(clearCookie.mock.calls[0]?.[1]).not.toHaveProperty('domain');
    expect(clearCookie.mock.calls[1]?.[1]).not.toHaveProperty('domain');
  });
});
