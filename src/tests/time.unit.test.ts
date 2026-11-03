import { describe, expect, it } from 'vitest';
import { cairoDayRange } from '../lib/time';

describe('Africa/Cairo date filters', () => {
  it('maps Nov 1 Cairo day across UTC midnight with inclusive lower and upper bounds', () => {
    const range = cairoDayRange('2026-11-01', '2026-11-01');
    expect(range.from?.toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-11-01T21:59:59.999Z');

    const atStart = new Date('2026-10-31T22:00:00.000Z');
    const justBeforeStart = new Date(atStart.getTime() - 1);
    const atEnd = new Date('2026-11-01T21:59:59.999Z');
    const justAfterEnd = new Date(atEnd.getTime() + 1);
    const cairo0030 = new Date('2026-10-31T22:30:00.000Z');
    const cairo2330 = new Date('2026-11-01T21:30:00.000Z');
    const includes = (value: Date) => value >= range.from! && value <= range.to!;
    expect([atStart, cairo0030, cairo2330, atEnd].every(includes)).toBe(true);
    expect(includes(justBeforeStart)).toBe(false);
    expect(includes(justAfterEnd)).toBe(false);
  });

  it('accepts a valid single-day range with no records as an empty result range', () => {
    const range = cairoDayRange('2026-11-02', '2026-11-02');
    expect(range.from?.toISOString()).toBe('2026-11-01T22:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-11-02T21:59:59.999Z');
  });
});
