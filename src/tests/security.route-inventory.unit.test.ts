import { describe, expect, it } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { enumerateRegisteredRoutes, isExplicitlyPublicRoute, routeProtectionIssues } from '../security/routeInventory';

const environment = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'security-route-access-secret-0000000001', REFRESH_TOKEN_SECRET: 'security-route-refresh-secret-0000002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});

describe('security route inventory', () => {
  it('enumerates every mounted API route and enforces auth, role/permission, and CSRF policy', () => {
    const app = createApp(environment, { logger: createLogger('silent') });
    const routes = enumerateRegisteredRoutes(app);
    expect(routes.length).toBeGreaterThan(60);
    expect(routeProtectionIssues(routes)).toEqual([]);
    expect(routes).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/v1/public/registrations', csrfOrigin: true }));
    expect(routes).toContainEqual(expect.objectContaining({ method: 'PATCH', path: '/api/v1/settings', auth: true, roles: ['admin'], csrfOrigin: true, csrfToken: true }));
    expect(isExplicitlyPublicRoute({ method: 'POST', path: '/api/v1/auth/change-password' })).toBe(false);
  });
});
