export type ErrorDetails = unknown;

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ErrorDetails) {
    super('VALIDATION_ERROR', message, 422, details);
  }
}
export class AuthError extends AppError {
  constructor(message = 'Authentication required') { super('UNAUTHENTICATED', message, 401); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super('FORBIDDEN', message, 403); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') { super('NOT_FOUND', message, 404); }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: ErrorDetails) { super('CONFLICT', message, 409, details); }
}
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') { super('RATE_LIMITED', message, 429); }
}
