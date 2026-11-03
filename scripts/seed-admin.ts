import 'dotenv/config';
import { parseEnvironment } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { connectDatabase, disconnectDatabase } from '../src/services/database';
import { seedAdmin } from '../src/services/seedAdmin';

async function main() {
  const environment = parseEnvironment();
  const allowTestDatabase = process.argv.includes('--allow-test-db');
  let databaseName = '';
  try { databaseName = decodeURIComponent(new URL(environment.MONGODB_URI).pathname.slice(1).split('/')[0] ?? ''); } catch { /* parseEnvironment already validates URI */ }
  if (databaseName.endsWith('_test') && !allowTestDatabase) throw new Error('Refusing to seed an _test database. Pass --allow-test-db only for an intentional test run.');
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
