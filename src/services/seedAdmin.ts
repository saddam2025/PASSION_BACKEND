import type pino from 'pino';
import { ConflictError } from '../lib/errors';
import { User } from '../models/User';
import { rolePermissionDefaults } from '../shared/schemas/permissions';
import { validatePasswordForEmail } from '../shared/schemas/authEndpoints';
import { writeAudit } from './audit';
import { hashPassword } from './passwords';

export async function seedAdmin(input: { email?: string; password?: string; name?: string }, logger: pino.Logger): Promise<'created' | 'exists'> {
  if (!input.email || !input.password || !input.name) throw new Error('SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_ADMIN_NAME are required.');
  const email = input.email.trim().toLowerCase();
  validatePasswordForEmail(email, input.password);
  if (await User.exists({ email })) return 'exists';
  try {
    const user = await User.create({ email, name: input.name.trim(), passwordHash: await hashPassword(input.password), role: 'admin', permissions: Object.fromEntries(rolePermissionDefaults.admin.map((key) => [key, true])), isActive: true });
    await writeAudit({ actorId: String(user._id), action: 'auth.seed_admin_created', entityType: 'user', entityId: String(user._id), afterStatus: 'admin_created' }, logger);
    return 'created';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000 && await User.exists({ email })) return 'exists';
    throw new ConflictError('Seed Admin could not be created');
  }
}
