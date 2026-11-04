import mongoose from 'mongoose';
import type pino from 'pino';

export function assertReplicaSetCapability(hello: { setName?: string } | undefined, required: boolean): void {
  if (required && !hello?.setName) throw new Error('MONGODB_URI must connect to a MongoDB replica set.');
}

export async function connectDatabase(
  uri: string,
  logger: pino.Logger,
  options: { dbName?: string; humanReadable?: boolean; requireReplicaSet?: boolean } = {},
): Promise<void> {
  const { dbName, humanReadable = false, requireReplicaSet = false } = options;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, ...(dbName ? { dbName } : {}) });
  let hello: { setName?: string } | undefined;
  try {
    hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  } catch {
    if (requireReplicaSet) {
      await mongoose.disconnect();
      throw new Error('MONGODB_URI replica-set capability could not be verified.');
    }
    if (humanReadable) process.stderr.write('[MongoDB] WARNING: Could not verify replica set capability\n');
    else logger.warn('Could not verify MongoDB replica set capability');
  }
  try {
    assertReplicaSetCapability(hello, requireReplicaSet);
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
  if (hello) {
    if (hello?.setName) {
      if (humanReadable) process.stdout.write('[MongoDB] Replica set check passed; transactions are enabled\n');
      else logger.info({ replicaSet: hello.setName }, 'MongoDB replica set check passed; transactions are enabled');
    } else {
      const message = 'MongoDB is not running as a replica set; transaction-backed workflows will not work';
      if (humanReadable) process.stderr.write(`[MongoDB] WARNING: ${message}\n`);
      else logger.warn(message);
    }
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
