import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { getReadinessStatus } from '../services/health';

export const livenessController: RequestHandler = (_request, response) => {
  response.json({ status: 'ok' });
};

export const readinessController: RequestHandler = asyncHandler(async (_request, response) => {
  response.json(await getReadinessStatus());
});
