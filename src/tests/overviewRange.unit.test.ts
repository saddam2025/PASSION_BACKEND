import { describe, expect, it } from 'vitest';
import { parseOverviewQuery } from '../shared/schemas/overview';

describe('overview range validation', () => {
  it('accepts valid Cairo calendar dates and treats omitted or blank bounds as all-time', () => {
    expect(parseOverviewQuery({ from: '2026-11-01', to: '2026-11-30' })).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(parseOverviewQuery({})).toEqual({});
    expect(parseOverviewQuery({ from: '', to: '' })).toEqual({});
  });

  it('returns a field-path validation error for malformed dates', () => {
    try { parseOverviewQuery({ from: '2026-02-30' }); expect.fail('expected validation error'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 422 });
      expect((error as { details: Array<{ path: string[] }> }).details[0]?.path).toContain('from');
    }
  });

  it('returns a typed INVALID_RANGE error for reversed dates', () => {
    expect(() => parseOverviewQuery({ from: '2026-11-03', to: '2026-11-02' })).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE', statusCode: 422 }));
  });

  it('accepts exactly 400 inclusive days and rejects longer ranges', () => {
    expect(parseOverviewQuery({ from: '2020-01-01', to: '2021-02-03' }).to).toBe('2021-02-03');
    expect(() => parseOverviewQuery({ from: '2020-01-01', to: '2021-02-04' })).toThrowError(expect.objectContaining({ code: 'RANGE_TOO_LARGE', statusCode: 422 }));
  });
});
