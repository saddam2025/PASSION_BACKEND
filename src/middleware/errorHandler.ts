import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

interface RequestWithId {
  requestId?: string;
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
  expose?: boolean;
  length?: number;
  limit?: number;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  void next;
  if (response.headersSent) return;
  const requestId = (request as typeof request & RequestWithId).requestId ?? randomUUID();
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let statusCode = 500;
  let details: unknown;

  if (error instanceof AppError) {
    ({ code, message, statusCode, details } = error);
  } else if (error instanceof ZodError || (typeof error === 'object' && error !== null && 'issues' in error)) {
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    statusCode = 400;
    details = 'issues' in error ? error.issues : undefined;
  } else if (error instanceof mongoose.Error.ValidationError) {
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    statusCode = 400;
    details = Object.values(error.errors).map(({ path, message: issueMessage }) => ({ path, message: issueMessage }));
  } else if (error instanceof mongoose.Error.CastError) {
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    statusCode = 400;
    details = [{ path: error.path, message: 'Invalid value' }];
  } else if (error instanceof SyntaxError && (error as BodyParserError).type === 'entity.parse.failed') {
    code = 'MALFORMED_JSON';
    message = 'Malformed JSON request body';
    statusCode = 400;
  } else if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
    statusCode = 413;
  } else if (error instanceof Error && error.name === 'CorsOriginError') {
    code = 'CORS_ORIGIN_DENIED';
    message = 'Origin is not allowed';
    statusCode = 403;
  }

  const logger = response.locals.logger;
  if (statusCode >= 500) {
    if (request.app.get('env') === 'production' || request.path.startsWith('/api/v1/public/registrations')) {
      logger?.error({ code, requestId }, 'Request failed');
    } else {
      logger?.error({ err: error, requestId }, 'Request failed');
    }
  }

  response.status(statusCode).json({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId,
    },
  });
};
