import { randomInt } from 'node:crypto';

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function generateEnrollmentReference(): string {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) suffix += alphabet[randomInt(alphabet.length)];
  return `PAS-${suffix}`;
}

export async function generateUniqueEnrollmentReference(exists: (reference: string) => Promise<boolean>, attempts = 8): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const reference = generateEnrollmentReference();
    if (!(await exists(reference))) return reference;
  }
  throw new Error('Could not allocate a unique enrollment reference');
}
