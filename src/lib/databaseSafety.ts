export function databaseNameFromUri(uri: string): string {
  try {
    return decodeURIComponent(new URL(uri).pathname.replace(/^\//, '').split('/')[0] ?? '');
  } catch {
    throw new Error('MONGODB_URI must identify a database name.');
  }
}

export function assertDatabaseTarget(uri: string, confirmedDatabase: string | undefined, allowTestDatabase = false): string {
  const databaseName = databaseNameFromUri(uri);
  if (!databaseName) throw new Error('MONGODB_URI must identify a database name.');
  if (databaseName.endsWith('_test') && !allowTestDatabase) {
    throw new Error('Refusing to modify an _test database. Add --allow-test-db only for an intentional test run.');
  }
  if (confirmedDatabase !== databaseName) {
    throw new Error('Database target confirmation required: pass --confirm-db with the exact database name from MONGODB_URI.');
  }
  return databaseName;
}
