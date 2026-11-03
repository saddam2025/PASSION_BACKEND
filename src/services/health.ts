import { AppError } from '../lib/errors';
import { pingDatabase } from './database';

export interface ReadinessStatus {
  status: 'ready';
  database: 'ok';
  version: string;
}

export async function getReadinessStatus(): Promise<ReadinessStatus> {
  try {
    await pingDatabase();
  } catch {
    throw new AppError('DATABASE_UNAVAILABLE', 'Database is not ready', 503);
  }
  return { status: 'ready', database: 'ok', version: process.env.npm_package_version ?? '0.1.0' };
}
