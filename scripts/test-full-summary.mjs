function count(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function parseVitestJson(text) {
  let result;
  try { result = JSON.parse(text); } catch { return { ok: false, reason: 'no test summary could be parsed' }; }
  if (!result || typeof result !== 'object' || !Array.isArray(result.testResults)) return { ok: false, reason: 'no test summary could be parsed' };
  const testResults = result.testResults;
  const files = {
    total: testResults.length,
    passed: testResults.filter((item) => item.status === 'passed').length,
    failed: testResults.filter((item) => item.status === 'failed').length,
    skipped: testResults.filter((item) => ['skipped', 'pending'].includes(item.status)).length,
  };
  const assertions = testResults.flatMap((file) => Array.isArray(file.assertionResults) ? file.assertionResults : []);
  const tests = {
    total: count(result.numTotalTests, assertions.length),
    passed: count(result.numPassedTests, assertions.filter((item) => item.status === 'passed').length),
    failed: count(result.numFailedTests, assertions.filter((item) => item.status === 'failed').length),
    skipped: Math.max(count(result.numSkippedTests), count(result.numPendingTests) + count(result.numTodoTests), assertions.filter((item) => ['pending', 'skipped', 'todo'].includes(item.status)).length),
  };
  const hasCounts = ['numTotalTestSuites', 'numTotalTests'].every((key) => Number.isInteger(result[key])) || (files.total > 0 && tests.total > 0);
  if (!hasCounts || files.total === 0 || tests.total === 0 || files.passed + files.failed + files.skipped !== files.total || tests.passed + tests.failed + tests.skipped !== tests.total) return { ok: false, reason: 'no test summary could be parsed' };
  const failedTests = assertions.filter((item) => item.status === 'failed').map((item) => [...(item.ancestorTitles ?? []), item.title ?? item.fullName ?? 'unnamed test'].join(' > '));
  return { ok: true, files, tests, failedTests: [...new Set(failedTests)] };
}
