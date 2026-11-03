import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const candidate = request.header('x-request-id');
  const requestId = candidate && /^[a-zA-Z0-9._-]{1,100}$/.test(candidate) ? candidate : randomUUID();
  Object.assign(request, { requestId });
  response.setHeader('x-request-id', requestId);
  next();
};
