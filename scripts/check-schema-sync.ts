import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
 const sourceRoot = resolve(process.env.FRONTEND_SCHEMAS_PATH ?? '../PASSION_FRONTEND/src/schemas');
 const targetRoot = resolve('src/shared/schemas');
 const manifest: Array<[string, string]> = [
  ['auth.ts', 'auth.ts'],
  ['course.ts', 'course.ts'], ['courseDraft.ts', 'courseDraft.ts'],
  ['registrationForm.ts', 'registrationForm.ts'],
 ];
 const sectionFiles = (await readdir(resolve(sourceRoot, 'sections'))).filter((file) => file.endsWith('.ts'));
 for (const file of sectionFiles) manifest.push([`sections/${file}`, `sections/${file}`]);
 const normalize = (value: string, file: string) => {
  let text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (file === 'course.ts') text = text.replaceAll("'@/schemas/sections'", "'./sections/index.js'").replaceAll("'@/schemas/registrationForm'", "'./registrationForm'");
  if (file.startsWith('sections/')) text = text.replace(/from ['"]@\/schemas\/([^'"]+)['"]/g, (_match, name: string) => `from '../${name}'`);
  return text;
 };
 let missing = false; let failures = 0;
 for (const [sourceFile, targetFile] of manifest) {
  let source: string;
  try { source = await readFile(resolve(sourceRoot, sourceFile), 'utf8'); }
  catch { missing = true; console.error(`Missing frontend schema source: ${resolve(sourceRoot, sourceFile)}`); continue; }
  let target: string;
  try { target = await readFile(resolve(targetRoot, targetFile), 'utf8'); }
  catch { console.error(`Missing backend schema copy: ${resolve(targetRoot, targetFile)}`); failures += 1; continue; }
  if (normalize(source, sourceFile) !== normalize(target, targetFile)) {
   console.error(`Schema drift: ${sourceFile} differs from ${targetFile}`); failures += 1;
  }
 }
 if (missing || failures) process.exitCode = 1;
 else process.stdout.write(`Schema sync passed for ${manifest.length} frontend schemas.\n`);
}
void main();
