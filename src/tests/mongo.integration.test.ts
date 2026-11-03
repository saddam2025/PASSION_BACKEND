import 'dotenv/config';
import mongoose from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app/createApp';
import { parseEnvironment } from '../config/env';
import { createLogger } from '../config/logger';
import { withTransaction } from '../lib/withTransaction';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';

const testUri = process.env.MONGODB_URI_TEST;
const allowSkip = process.env.ALLOW_SKIP_DB_TESTS === '1';
const describeMongo = testUri ? describe : describe.skip;

if (!testUri) {
  if (!allowSkip) throw new Error('MongoDB integration tests require MONGODB_URI_TEST. Set ALLOW_SKIP_DB_TESTS=1 only to explicitly skip database tests.');
  console.warn('[SKIPPED] BE-1 MongoDB integration tests: MONGODB_URI_TEST is missing; explicitly allowed by ALLOW_SKIP_DB_TESTS=1.');
}
if (testUri && process.env.NODE_ENV !== 'test') throw new Error('MongoDB integration tests refuse to run unless NODE_ENV=test.');
const testDbName = assertTestDatabaseName(process.env.MONGODB_TEST_DB || 'passion_test');

let app: Express;

function testEnvironment(uri: string) {
  return parseEnvironment({
    NODE_ENV: 'test',
    PORT: '4000',
    MONGODB_URI: uri,
    ACCESS_TOKEN_SECRET: 'access-secret-for-integration-tests-only-0001',
    REFRESH_TOKEN_SECRET: 'refresh-secret-for-integration-tests-only-0002',
    COOKIE_DOMAIN: 'localhost',
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: 'http://localhost:5173',
    APP_BASE_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  });
}

beforeAll(async () => {
  if (!testUri) return;
  await mongoose.connect(testUri, { dbName: testDbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  await clearNamedCollections(mongoose.connection, ['be1_transaction_records']);
  app = createApp(testEnvironment(testUri), { logger: createLogger('silent') });
}, 60_000);

afterAll(async () => {
  if (!testUri) return;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(testUri, { dbName: testDbName, serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  }
  await clearNamedCollections(mongoose.connection, ['be1_transaction_records']);
  await mongoose.disconnect();
});

describeMongo('BE-1 MongoDB Atlas integration', () => {
  it('passes readiness while MongoDB is connected', async () => {
    const response = await request(app).get('/api/v1/health/ready').expect(200);
    expect(response.body).toMatchObject({ status: 'ready', database: 'ok', version: '0.1.0' });
  });

  it('commits transactions and rolls back failed callbacks', async () => {
    const recordSchema = new mongoose.Schema({ value: { type: String, required: true } });
    interface TransactionRecord { value: string }
    const Record = (mongoose.models.Be1AtlasTransactionRecord as mongoose.Model<TransactionRecord> | undefined)
      ?? mongoose.model<TransactionRecord>('Be1AtlasTransactionRecord', recordSchema, 'be1_transaction_records');
    await Record.deleteMany({});

    await withTransaction(async (session) => {
      await Record.create([{ value: 'committed' }], { session });
      return 'committed';
    });
    expect(await Record.countDocuments({ value: 'committed' })).toBe(1);

    await expect(withTransaction(async (session) => {
      await Record.create([{ value: 'rolled-back' }], { session });
      throw new Error('intentional rollback verification');
    })).rejects.toThrow('intentional rollback verification');
    expect(await Record.countDocuments({ value: 'rolled-back' })).toBe(0);
  });

  it('returns the standard readiness error after the database disconnects', async () => {
    await mongoose.disconnect();
    const response = await request(app).get('/api/v1/health/ready').expect(503);
    expect(response.body.error).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
});
