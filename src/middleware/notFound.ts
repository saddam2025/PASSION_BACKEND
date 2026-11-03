import type { RequestHandler } from 'express';
import { NotFoundError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new NotFoundError(`Route ${request.method} ${request.path} not found`));
};
