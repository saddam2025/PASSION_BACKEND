import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVitestJson } from './test-full-summary.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requested = process.argv.slice(2);
const fast = requested.includes('--fast');
const passthrough = requested.filter((argument) => argument !== '--fast');
const runner = resolve(root, 'node_modules/vitest/vitest.mjs');
const temp = resolve(root, '.vitest-tmp');
const resultsPath = resolve(root, 'test-results.json');
const outputPath = resolve(root, 'test-output.txt');
await mkdir(temp, { recursive: true });
await unlink(resultsPath).catch(() => {});

const args = [runner, 'run', ...(fast ? ['--config', 'vitest.fast.config.mts'] : []), '--reporter=default', '--reporter=json', '--outputFile=test-results.json', ...passthrough];
const startedAt = Date.now();
const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp }, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] });
let output = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
const exitCode = await new Promise((resolveExit) => child.once('close', (code) => resolveExit(code ?? 1)));
const durationMs = Date.now() - startedAt;
await writeFile(outputPath, output, { encoding: 'utf8' });

let parsed;
try { parsed = parseVitestJson(await readFile(resultsPath, 'utf8')); }
catch { parsed = { ok: false, reason: 'no test summary could be parsed' }; }
if (!parsed.ok) {
  process.stderr.write(`FAILED: ${parsed.reason}; see test-output.txt\n`);
  process.exitCode = 1;
} else {
  const { files, tests, failedTests } = parsed;
  const duration = `${(durationMs / 1000).toFixed(2)}s`;
  process.stdout.write(`Test Files: ${files.passed} passed, ${files.failed} failed, ${files.skipped} skipped (${files.total}); Tests: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped (${tests.total}); Duration: ${duration}.\n`);
  process.stdout.write(`Failed tests: ${failedTests.length ? failedTests.join(' | ') : 'none'}\n`);
  if (exitCode !== 0 || files.total === 0 || tests.total === 0 || files.failed > 0 || files.skipped > 0 || tests.failed > 0 || tests.skipped > 0) process.exitCode = 1;
}
