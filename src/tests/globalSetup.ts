import 'dotenv/config';
import mongoose from 'mongoose';
import { assertTestDatabaseName } from './mongoTestSafety';

export async function setup() {
  const uri = process.env.MONGODB_URI_TEST;
  if (!uri) throw new Error('Vitest global setup requires MONGODB_URI_TEST.');
  if (process.env.NODE_ENV !== 'test') throw new Error('Vitest global setup requires NODE_ENV=test.');
  const dbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '');
  mongoose.set('autoIndex', false);
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (!hello?.setName) throw new Error('Test database must be a replica set.');
    const { User, Invite, PasswordReset, RefreshToken, Course, Lead, Enrollment, Payment, Note, Notification, AuditLog, Settings, Category, Media } = await import('../models/index.js');
    const models = [User, Invite, PasswordReset, RefreshToken, Course, Lead, Enrollment, Payment, Note, Notification, AuditLog, Settings, Category, Media];
    for (const model of models) await model.syncIndexes();
  } catch (error) {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    throw new Error(`Vitest test database/index setup failed: ${errorClass}`);
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}
