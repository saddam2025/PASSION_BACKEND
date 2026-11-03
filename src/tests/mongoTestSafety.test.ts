import { describe, expect, it } from 'vitest';
import { assertTestDatabaseName, clearNamedCollections } from './mongoTestSafety';
import type { Connection } from 'mongoose';

describe('MongoDB test database safety', () => {
  it('refuses a database name that does not end with _test', () => {
    expect(assertTestDatabaseName('passion_test')).toBe('passion_test');
    expect(() => assertTestDatabaseName('passion')).toThrow(/ending in _test/);
  });
  it('clears only the collections explicitly owned by the test setup', async () => {
    const cleared: string[] = [];
    const fakeConnection = { collection: (name: string) => ({ deleteMany: async () => { cleared.push(name); } }) } as unknown as Pick<Connection, 'collection'>;
    await clearNamedCollections(fakeConnection, ['courses', 'users', 'courses']);
    expect(cleared).toEqual(['courses', 'users']);
  });
});
