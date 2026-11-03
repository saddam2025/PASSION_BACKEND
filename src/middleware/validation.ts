import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export interface RequestSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, _response, next) => {
    const parsed: Record<string, unknown> = {};
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(request[key]);
      if (!result.success) {
        next({
          name: 'ZodError',
          issues: result.error.issues,
        });
        return;
      }
      parsed[key] = result.data;
    }
    Object.assign(request, parsed);
    next();
  };
}
