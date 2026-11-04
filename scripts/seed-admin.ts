import 'dotenv/config';
import { parseEnvironment } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { connectDatabase, disconnectDatabase } from '../src/services/database';
import { seedAdmin } from '../src/services/seedAdmin';
import { assertDatabaseTarget } from '../src/lib/databaseSafety';

async function main() {
  const environment = parseEnvironment();
  const allowTestDatabase = process.argv.includes('--allow-test-db');
  const confirmedDatabase = process.argv.find((argument) => argument.startsWith('--confirm-db='))?.slice('--confirm-db='.length);
  assertDatabaseTarget(environment.MONGODB_URI, confirmedDatabase, allowTestDatabase);
  const logger = createLogger(environment.LOG_LEVEL);
  await connectDatabase(environment.MONGODB_URI, logger);
  try {
    const result = await seedAdmin({ email: environment.SEED_ADMIN_EMAIL, password: environment.SEED_ADMIN_PASSWORD, name: environment.SEED_ADMIN_NAME }, logger);
    logger.info({ result }, result === 'created' ? 'Seed Admin created' : 'Seed Admin already exists; no changes made');
  } finally { await disconnectDatabase(); }
}
main().catch((error: unknown) => {
  process.stderr.write(`Seed Admin failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
