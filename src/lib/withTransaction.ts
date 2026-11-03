import mongoose, { type ClientSession } from 'mongoose';

export async function withTransaction<T>(
  operation: (session: ClientSession) => Promise<T>,
  connection: typeof mongoose = mongoose,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result: T | undefined;
    let completed = false;
    await session.withTransaction(async () => {
      result = await operation(session);
      completed = true;
    });
    if (!completed) throw new Error('Transaction completed without running its operation');
    return result as T;
  } finally {
    await session.endSession();
  }
}
