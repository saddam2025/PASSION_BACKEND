import { Algorithm } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { PASSWORD_HASH_PRODUCTION_OPTIONS, passwordHashOptions } from '../services/passwords';

describe('password hashing configuration', () => {
  it('keeps production on Argon2id with at least the established production costs', () => {
    expect(PASSWORD_HASH_PRODUCTION_OPTIONS.algorithm).toBe(Algorithm.Argon2id);
    expect(PASSWORD_HASH_PRODUCTION_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(PASSWORD_HASH_PRODUCTION_OPTIONS.timeCost).toBeGreaterThanOrEqual(2);
    expect(passwordHashOptions('production')).toBe(PASSWORD_HASH_PRODUCTION_OPTIONS);
  });

  it('uses bounded, config-driven cheaper costs only in test mode', () => {
    const priorMemory = process.env.TEST_ARGON2_MEMORY_COST;
    const priorTime = process.env.TEST_ARGON2_TIME_COST;
    process.env.TEST_ARGON2_MEMORY_COST = '2048';
    process.env.TEST_ARGON2_TIME_COST = '1';
    try {
      expect(passwordHashOptions('test')).toMatchObject({ algorithm: Algorithm.Argon2id, memoryCost: 2_048, timeCost: 1 });
      expect(passwordHashOptions('development')).toBe(PASSWORD_HASH_PRODUCTION_OPTIONS);
    } finally {
      if (priorMemory === undefined) delete process.env.TEST_ARGON2_MEMORY_COST;
      else process.env.TEST_ARGON2_MEMORY_COST = priorMemory;
      if (priorTime === undefined) delete process.env.TEST_ARGON2_TIME_COST;
      else process.env.TEST_ARGON2_TIME_COST = priorTime;
    }
  });
});
