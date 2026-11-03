import { Algorithm, hash, verify } from '@node-rs/argon2';

export const PASSWORD_HASH_PRODUCTION_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

function configuredTestCost(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function passwordHashOptions(nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== 'test') return PASSWORD_HASH_PRODUCTION_OPTIONS;
  return {
    ...PASSWORD_HASH_PRODUCTION_OPTIONS,
    memoryCost: configuredTestCost('TEST_ARGON2_MEMORY_COST', 4_096, 1_024, PASSWORD_HASH_PRODUCTION_OPTIONS.memoryCost),
    timeCost: configuredTestCost('TEST_ARGON2_TIME_COST', 1, 1, PASSWORD_HASH_PRODUCTION_OPTIONS.timeCost),
  };
}

const dummyHash = hashPassword('a-random-not-a-user-password-value-7Z!');

export function hashPassword(password: string): Promise<string> { return hash(password, passwordHashOptions()); }
export function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  return verify(encodedHash, password, passwordHashOptions()).catch(() => false);
}
export function verifyDummyPassword(password: string): Promise<boolean> {
  return dummyHash.then((encoded) => verifyPassword(password, encoded));
}
