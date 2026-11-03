import 'dotenv/config';
import mongoose from 'mongoose';
import { assertTestDatabaseName } from '../src/tests/mongoTestSafety';

async function main() {
  const uri = process.env.MONGODB_URI_TEST;
  if (!uri) throw new Error('MONGODB_URI_TEST is not configured.');
  const uriDatabase = decodeURIComponent(new URL(uri).pathname.replace(/^\//, '').split('/')[0] ?? '');
  const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || uriDatabase);
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) throw new Error('The test database is not a replica set; transaction tests require a replica set.');
  await mongoose.connection.db?.admin().command({ ping: 1 });
  process.stdout.write('MONGODB_URI_TEST is configured; _test database is reachable and transactions are supported.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`Test database check failed: ${error instanceof Error ? error.constructor.name : 'UnknownError'}\n`);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});
