import type { Connection } from 'mongoose';

export function assertTestDatabaseName(name: string): string {
  if (!name.endsWith('_test')) throw new Error('MongoDB tests require a database name ending in _test.');
  return name;
}

export async function clearNamedCollections(connection: Pick<Connection, 'collection'>, names: readonly string[]): Promise<void> {
  for (const name of new Set(names)) await connection.collection(name).deleteMany({});
}
