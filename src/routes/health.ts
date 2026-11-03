import { Router } from 'express';
import { livenessController, readinessController } from '../controllers/healthController';

export const healthRouter = Router();

healthRouter.get('/health', livenessController);
healthRouter.get('/health/ready', readinessController);
