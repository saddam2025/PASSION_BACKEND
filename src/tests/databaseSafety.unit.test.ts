import { describe, expect, it } from 'vitest';
import { assertDatabaseTarget, databaseNameFromUri } from '../lib/databaseSafety';
import { assertReplicaSetCapability } from '../services/database';

describe('database target safety guards', () => {
  it('requires explicit confirmation of the exact database name before index sync', () => {
    const uri = 'mongodb+srv://user:password@example.invalid/passion?retryWrites=true';
    expect(databaseNameFromUri(uri)).toBe('passion');
    expect(() => assertDatabaseTarget(uri, undefined)).toThrow(/--confirm-db/);
    expect(() => assertDatabaseTarget(uri, 'other')).toThrow(/--confirm-db/);
    expect(assertDatabaseTarget(uri, 'passion')).toBe('passion');
  });

  it('refuses _test databases unless both safety switches are explicit', () => {
    const uri = 'mongodb+srv://user:password@example.invalid/passion_test';
    expect(() => assertDatabaseTarget(uri, 'passion_test')).toThrow(/_test database/);
    expect(assertDatabaseTarget(uri, 'passion_test', true)).toBe('passion_test');
  });

  it('requires the live MongoDB handshake to advertise a replica set in production', () => {
    expect(() => assertReplicaSetCapability({ setName: 'atlas-rs' }, true)).not.toThrow();
    expect(() => assertReplicaSetCapability({}, true)).toThrow(/MONGODB_URI/);
    expect(() => assertReplicaSetCapability(undefined, true)).toThrow(/MONGODB_URI/);
    expect(() => assertReplicaSetCapability({}, false)).not.toThrow();
  });
});
