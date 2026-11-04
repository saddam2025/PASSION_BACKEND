import type { Express, RequestHandler, Router } from 'express';

export const routeSecurityKey = Symbol('passion.route-security');

export interface RouteSecurityMetadata {
  auth?: true;
  roles?: string[];
  permissions?: string[];
  csrfOrigin?: true;
  csrfToken?: true;
}

export interface MountedRouteRouter { path: string; router: Router }
export interface RouteSecurityRecord extends RouteSecurityMetadata {
  method: string;
  path: string;
}

interface ExpressRouteLayer {
  path: string | string[];
  methods: Record<string, boolean>;
  stack: Array<{ handle: RequestHandler }>;
}

interface ExpressRouterLayer {
  route?: ExpressRouteLayer;
  name?: string;
  handle?: RequestHandler & { stack?: ExpressRouterLayer[] };
}

export function markRouteSecurity<T extends RequestHandler>(handler: T, metadata: RouteSecurityMetadata): T {
  const current = (handler as T & { [routeSecurityKey]?: RouteSecurityMetadata })[routeSecurityKey] ?? {};
  Object.defineProperty(handler, routeSecurityKey, { value: { ...current, ...metadata }, configurable: true });
  return handler;
}

function metadataFor(handler: RequestHandler): RouteSecurityMetadata {
  return (handler as RequestHandler & { [routeSecurityKey]?: RouteSecurityMetadata })[routeSecurityKey] ?? {};
}

function mergeMetadata(target: RouteSecurityMetadata, source: RouteSecurityMetadata): RouteSecurityMetadata {
  return {
    ...(target.auth || source.auth ? { auth: true } : {}),
    ...(target.roles || source.roles ? { roles: [...(target.roles ?? []), ...(source.roles ?? [])] } : {}),
    ...(target.permissions || source.permissions ? { permissions: [...(target.permissions ?? []), ...(source.permissions ?? [])] } : {}),
    ...(target.csrfOrigin || source.csrfOrigin ? { csrfOrigin: true } : {}),
    ...(target.csrfToken || source.csrfToken ? { csrfToken: true } : {}),
  };
}

function joinPath(prefix: string, child: string): string {
  return `/${[prefix, child].join('/').split('/').filter(Boolean).join('/')}`;
}

function enumerateRouter(router: Router, prefix: string, inherited: RouteSecurityMetadata, output: RouteSecurityRecord[]): void {
  let security = inherited;
  for (const layer of ((router as unknown as { stack: ExpressRouterLayer[] }).stack ?? [])) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of routePaths) {
        let routeSecurity = security;
        for (const routeLayer of layer.route.stack as Array<{ handle: RequestHandler }>) routeSecurity = mergeMetadata(routeSecurity, metadataFor(routeLayer.handle));
        const path = joinPath(prefix, String(routePath));
        for (const method of Object.keys(layer.route.methods as Record<string, boolean>)) {
          output.push({ method: method.toUpperCase(), path, ...routeSecurity });
        }
      }
      continue;
    }
    if (layer.name === 'router' && layer.handle?.stack) {
      // Nested routers are not currently used in the API tree. Keep their routes
      // visible if one is added later; Express layer mount paths are recorded by
      // createApp when top-level routers are mounted.
      enumerateRouter(layer.handle as unknown as Router, prefix, security, output);
      continue;
    }
    if (typeof layer.handle === 'function') security = mergeMetadata(security, metadataFor(layer.handle));
  }
}

export function enumerateRegisteredRoutes(app: Express): RouteSecurityRecord[] {
  const mounts = (app.locals.securityRouteRouters ?? []) as MountedRouteRouter[];
  const routes: RouteSecurityRecord[] = [];
  for (const mount of mounts) enumerateRouter(mount.router, mount.path, {}, routes);
  return routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

export const publicRouteAllowlist: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/v1\/health(?:\/ready)?$/ },
  { method: 'GET', path: /^\/api\/v1\/public\/courses(?:\/[^/]+)?$/ },
  { method: 'GET', path: /^\/api\/v1\/public\/registrations\/[^/]+$/ },
  { method: 'POST', path: /^\/api\/v1\/public\/registrations$/ },
  { method: 'GET', path: /^\/api\/v1\/(?:settings\/public|categories(?:\/public)?|seo\/.*)$/ },
  { method: 'GET', path: /^\/api\/v1\/auth\/(?:csrf|invites\/[^/]+)$/ },
  { method: 'POST', path: /^\/api\/v1\/auth\/(?:login|refresh|logout|invites\/accept|password-reset\/(?:request|confirm))$/ },
];

export function isExplicitlyPublicRoute(route: Pick<RouteSecurityRecord, 'method' | 'path'>): boolean {
  return publicRouteAllowlist.some((entry) => entry.method === route.method && entry.path.test(route.path));
}

export function routeProtectionIssues(routes: RouteSecurityRecord[]): string[] {
  const issues: string[] = [];
  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    const isPublic = isExplicitlyPublicRoute(route);
    if (!route.auth && !isPublic) issues.push(`${label}: missing requireAuth and not in public allowlist`);
    if (route.auth && !route.roles?.length && !route.permissions?.length) issues.push(`${label}: authenticated route has no role or permission check`);
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method);
    const publicRegistrationException = route.method === 'POST' && route.path === '/api/v1/public/registrations';
    if (mutating && !publicRegistrationException && (!route.csrfOrigin || !route.csrfToken)) issues.push(`${label}: missing same-origin and CSRF token checks`);
    if (publicRegistrationException && !route.csrfOrigin) issues.push(`${label}: documented exception still requires same-origin validation`);
  }
  return issues;
}
