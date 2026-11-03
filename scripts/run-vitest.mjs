import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = resolve(root, '.vitest-tmp');
await mkdir(temp, { recursive: true });
const runner = resolve(root, 'node_modules/vitest/vitest.mjs');
const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp },
  windowsHide: true,
  stdio: 'inherit',
});
const code = await new Promise((done) => child.once('close', (exitCode) => done(exitCode ?? 1)));
process.exitCode = code;
