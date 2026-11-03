import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { parseEnvironment } from '../config/env';
import { R2StorageDriver } from '../services/storageDriver';

const labels = ['public upload', 'private upload', 'read back', 'private signed URL', 'private unsigned access denied', 'cleanup'];
const results = new Map<string, boolean>();
async function main() {
  const environment = parseEnvironment();
  if (!environment.R2_ACCOUNT_ID || !environment.R2_ACCESS_KEY_ID || !environment.R2_SECRET_ACCESS_KEY || !environment.R2_PUBLIC_BUCKET || !environment.R2_PRIVATE_BUCKET || !environment.R2_PUBLIC_BASE_URL) throw new Error('R2 environment is not configured');
  const storage = new R2StorageDriver(environment);
  const keyBase = `smoke/${randomUUID()}`;
  const publicKey = `${keyBase}-public.txt`;
  const privateKey = `${keyBase}-private.txt`;
  const body = Buffer.from('passion-r2-smoke');
  try {
    await storage.put({ bucket: 'public', key: publicKey, body, contentType: 'text/plain', cacheControl: 'public, max-age=60' }); results.set(labels[0]!, true);
    await storage.put({ bucket: 'private', key: privateKey, body, contentType: 'text/plain' }); results.set(labels[1]!, true);
    const [publicRead, privateRead] = await Promise.all([storage.get('public', publicKey), storage.get('private', privateKey)]);
    results.set(labels[2]!, Boolean(publicRead?.body.equals(body) && privateRead?.body.equals(body)));
    const signed = await storage.signedGetUrl('private', privateKey, 60);
    const signedResponse = await fetch(signed);
    results.set(labels[3]!, signedResponse.ok && Buffer.from(await signedResponse.arrayBuffer()).equals(body));
    const unsigned = await fetch(`https://${environment.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${environment.R2_PRIVATE_BUCKET}/${privateKey}`);
    results.set(labels[4]!, !unsigned.ok);
  } finally {
    const failures = await Promise.allSettled([storage.delete('public', publicKey), storage.delete('private', privateKey)]);
    results.set(labels[5]!, failures.every((result) => result.status === 'fulfilled'));
  }
  for (const label of labels) process.stdout.write(`${results.get(label) ? 'PASS' : 'FAIL'} ${label}\n`);
  if ([...results.values()].some((ok) => !ok)) process.exitCode = 1;
}
main().catch(() => {
  for (const label of labels) process.stdout.write(`FAIL ${label}\n`);
  process.exitCode = 1;
});
