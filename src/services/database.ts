import mongoose from 'mongoose';
import type pino from 'pino';

export async function connectDatabase(
  uri: string,
  logger: pino.Logger,
  options: { dbName?: string; humanReadable?: boolean } = {},
): Promise<void> {
  const { dbName, humanReadable = false } = options;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, ...(dbName ? { dbName } : {}) });
  try {
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (hello?.setName) {
      if (humanReadable) process.stdout.write('[MongoDB] Replica set check passed; transactions are enabled\n');
      else logger.info({ replicaSet: hello.setName }, 'MongoDB replica set check passed; transactions are enabled');
    } else {
      const message = 'MongoDB is not running as a replica set; transaction-backed workflows will not work';
      if (humanReadable) process.stderr.write(`[MongoDB] WARNING: ${message}\n`);
      else logger.warn(message);
    }
  } catch {
    if (humanReadable) process.stderr.write('[MongoDB] WARNING: Could not verify replica set capability\n');
    else logger.warn('Could not verify MongoDB replica set capability');
  }
  if (humanReadable) {
    process.stdout.write('[MongoDB] Connected\n');
    process.stdout.write(`[MongoDB] Database: ${mongoose.connection.name}\n`);
  } else {
    logger.info('MongoDB connection established');
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export async function pingDatabase(): Promise<void> {
  const database = mongoose.connection.db;
  if (!database || mongoose.connection.readyState !== 1) throw new Error('Database connection is not ready');
  await database.admin().ping();
}
