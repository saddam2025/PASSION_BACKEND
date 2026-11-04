import type { RequestHandler } from 'express';
import type { AppEnvironment } from '../config/env';
import { AuthError, ForbiddenError } from '../lib/errors';
import { User } from '../models/User';
import { cookieNames, effectivePermissions, verifyAccessToken } from '../services/authTokens';
import type { PermissionKey } from '../shared/schemas/permissions';
import { hasPermission as roleHasPermission } from '../shared/schemas/permissions';
import { markRouteSecurity } from '../security/routeInventory';

export function requireAuth(environment: AppEnvironment): RequestHandler {
  const names = cookieNames(environment);
  return markRouteSecurity(async (request, _response, next) => {
    try {
      const token = request.cookies?.[names.access];
      if (typeof token !== 'string') throw new AuthError();
      const claims = verifyAccessToken(token, environment);
      const user = await User.findById(claims.userId);
      if (!user || !user.isActive || user.tokenVersion !== claims.tokenVersion) throw new AuthError();
      request.auth = { id: String(user._id), name: { ar: user.name }, email: user.email, role: user.role, permissions: effectivePermissions(user) };
      next();
    } catch (error) {
      next(error instanceof AuthError ? error : new AuthError());
    }
  }, { auth: true });
}

export function requireRole(...roles: Array<'admin' | 'assistant'>): RequestHandler {
  return markRouteSecurity((request, _response, next) => {
    if (!request.auth) return next(new AuthError());
    if (!roles.includes(request.auth.role)) return next(new ForbiddenError());
    next();
  }, { roles: [...roles] });
}

export function requirePermission(permission: PermissionKey): RequestHandler {
  return markRouteSecurity((request, _response, next) => {
    if (!request.auth) return next(new AuthError());
    if (!roleHasPermission(request.auth, permission)) return next(new ForbiddenError());
    next();
  }, { permissions: [permission] });
}

export function assertOwnerOrAdmin(actor: { id: string; role: 'admin' | 'assistant' }, ownerId: string): void {
  if (actor.role !== 'admin' && actor.id !== ownerId) throw new ForbiddenError();
}
