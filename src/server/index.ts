import 'dotenv/config';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app/createApp';
import { createLogger } from '../config/logger';
import { parseEnvironment } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../services/database';

async function startServer(): Promise<void> {
  let environment;
  try {
    environment = parseEnvironment();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid environment configuration'}\n`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(environment.LOG_LEVEL);
  try {
    await connectDatabase(environment.MONGODB_URI, logger, { humanReadable: environment.NODE_ENV === 'development' });
  } catch {
    process.stderr.write('Database connection failed. Check that MONGODB_URI is valid and the database is reachable.\n');
    process.exitCode = 1;
    return;
  }
  const app = createApp(environment, { logger });
  const server = app.listen(environment.PORT, () => {
    const address = server.address() as AddressInfo;
    if (environment.NODE_ENV === 'development') process.stdout.write(`[Server] Passion Platform API running on port ${address.port}\n`);
    else logger.info({ port: address.port }, 'API server listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    server.close((error) => {
      if (error) logger.error({ err: error }, 'HTTP server shutdown failed');
      void disconnectDatabase().finally(() => {
        if (error) process.exitCode = 1;
        logger.info('Shutdown complete');
      });
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

void startServer().catch((error: unknown) => {
  process.stderr.write(`Backend startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
