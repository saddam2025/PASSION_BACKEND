import 'dotenv/config';
import mongoose from 'mongoose';
import * as modelExports from '../models';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    process.stderr.write('MONGODB_URI is required to synchronize indexes.\n');
    process.exitCode = 1;
  } else {
    try {
      await mongoose.connect(uri);
      const models = Object.values(modelExports);
      for (const model of models) {
        const changes = await model.syncIndexes();
        const indexes = await model.collection.indexes();
        const names = indexes.map((index) => index.name).filter((name): name is string => Boolean(name));
        process.stdout.write(`${model.collection.name}: ${names.join(', ')} (synchronized; ${changes.length} obsolete removed).\n`);
      }
    } catch (error) {
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
