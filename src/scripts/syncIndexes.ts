import 'dotenv/config';
import mongoose from 'mongoose';
import * as modelExports from '../models';
import { assertDatabaseTarget } from '../lib/databaseSafety';

async function main() {
  const uri = process.env.MONGODB_URI;
  const confirmedDatabase = process.argv.find((argument) => argument.startsWith('--confirm-db='))?.slice('--confirm-db='.length);
  const allowTestDatabase = process.argv.includes('--allow-test-db');
  if (!uri) {
    process.stderr.write('MONGODB_URI is required to synchronize indexes.\n');
    process.exitCode = 1;
  } else {
    try {
      assertDatabaseTarget(uri, confirmedDatabase, allowTestDatabase);
      await mongoose.connect(uri);
      const models = Object.values(modelExports);
      for (const model of models) {
        const changes = await model.syncIndexes();
        const indexes = await model.collection.indexes();
        const names = indexes.map((index) => index.name).filter((name): name is string => Boolean(name));
        process.stdout.write(`${model.collection.name}: ${names.join(', ')} (synchronized; ${changes.length} obsolete removed).\n`);
      }
    } catch (error) {
      if (error instanceof Error && /^(MONGODB_URI must identify a database name|Refusing to modify an _test database|Database target confirmation required)/.test(error.message)) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        return;
      }
      const errorClasses: string[] = [];
      let current: unknown = error;
      while (current instanceof Error && errorClasses.length < 5) {
        errorClasses.push(current.constructor.name || current.name);
        current = current.cause;
      }
      process.stderr.write(`Index synchronization failed (${errorClasses.join(' caused by ') || 'UnknownError'}). No error messages or connection details were logged.\n`);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  }
}

void main();
