import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runner = resolve(root, 'scripts/run-vitest.mjs');
const node = process.execPath;
async function run(args) {
  const child = spawn(node, [runner, 'run', ...args], { cwd: root, env: process.env, windowsHide: true, stdio: 'inherit' });
  return await new Promise((resolveExit) => child.once('close', (code) => resolveExit(code ?? 1)));
}
const changedExit = await run(['--changed']);
if (changedExit !== 0) process.exitCode = changedExit;
const unitExit = await run(['--config', 'vitest.fast.config.mts', 'src/tests/**/*.unit.test.ts']);
if (unitExit !== 0) process.exitCode = unitExit;
