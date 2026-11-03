import { describe, expect, it } from 'vitest';
// @ts-expect-error The helper is plain ESM so the CLI runner can import it directly.
import { parseVitestJson } from '../../scripts/test-full-summary.mjs';

const fixture = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  numTotalTestSuites: 1, numPassedTestSuites: 1, numFailedTestSuites: 0, numSkippedTestSuites: 0,
  numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numSkippedTests: 0,
  testResults: [{ status: 'passed', assertionResults: [{ status: 'passed', title: 'one' }, { status: 'passed', title: 'two' }] }],
  ...overrides,
});

describe('parseVitestJson', () => {
  it('parses passed counts', () => { expect(parseVitestJson(fixture())).toMatchObject({ ok: true, files: { total: 1, passed: 1 }, tests: { total: 2, passed: 2 }, failedTests: [] }); });
  it('parses failed test names and counts', () => { const json = fixture({ numFailedTests: 1, numPassedTests: 1, testResults: [{ status: 'failed', assertionResults: [{ status: 'failed', ancestorTitles: ['suite'], title: 'fails' }, { status: 'passed', title: 'passes' }] }] }); expect(parseVitestJson(json)).toMatchObject({ ok: true, tests: { failed: 1, passed: 1 }, failedTests: ['suite > fails'] }); });
  it('counts skipped tests', () => { expect(parseVitestJson(fixture({ numSkippedTests: 1, numPassedTests: 1 }))).toMatchObject({ ok: true, tests: { skipped: 1 } }); });
  it('rejects an empty zero-test report', () => { expect(parseVitestJson(JSON.stringify({ numTotalTestSuites: 0, numTotalTests: 0, testResults: [] }))).toMatchObject({ ok: false }); });
  it('rejects malformed JSON and missing results', () => { expect(parseVitestJson('{broken')).toMatchObject({ ok: false }); expect(parseVitestJson('{}')).toMatchObject({ ok: false }); });
});
