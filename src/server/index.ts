import 'dotenv/config';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app/createApp';
import { createLogger } from '../config/logger';
import { parseEnvironment } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../services/database';
import { registerGracefulShutdown } from './shutdown';

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
    await connectDatabase(environment.MONGODB_URI, logger, { humanReadable: environment.NODE_ENV === 'development', requireReplicaSet: environment.NODE_ENV === 'production' });
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

  registerGracefulShutdown(server, disconnectDatabase, logger);
}

void startServer().catch((error: unknown) => {
  process.stderr.write(`Backend startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
