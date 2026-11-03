import mongoose from 'mongoose';
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/errors';
import { RefreshToken } from '../models/RefreshToken';
import { User } from '../models/User';
import type { UserDocument } from '../models/User';
import type { PermissionKey } from '../shared/schemas/permissions';
import { rolePermissionDefaults } from '../shared/schemas/permissions';
import { writeAudit } from './audit';
import type pino from 'pino';

const safeUser = (user: UserDocument) => {
  return { id: String(user._id), name: { ar: user.name }, email: user.email, role: user.role, permissions: user.role === 'admin' ? [...rolePermissionDefaults.admin] : [...rolePermissionDefaults.assistant], active: user.isActive, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt };
};

export const usersService = {
  async list(input: { page: number; pageSize: number; search?: string; role?: 'admin' | 'assistant'; active?: 'true' | 'false'; sort: 'newest' | 'oldest' | 'name' | 'email' }) {
    const filter: Record<string, unknown> = {};
    if (input.search) filter.$or = [{ name: { $regex: escapeRegex(input.search), $options: 'i' } }, { email: { $regex: escapeRegex(input.search), $options: 'i' } }];
    if (input.role) filter.role = input.role;
    if (input.active) filter.isActive = input.active === 'true';
    const sort: Record<string, 1 | -1> = input.sort === 'newest' ? { createdAt: -1 } : input.sort === 'oldest' ? { createdAt: 1 } : input.sort === 'name' ? { name: 1 } : { email: 1 };
    const [users, total] = await Promise.all([User.find(filter).sort(sort).skip((input.page - 1) * input.pageSize).limit(input.pageSize), User.countDocuments(filter)]);
    return { items: users.map(safeUser), total, page: input.page, pageSize: input.pageSize };
  },
  async get(id: string) { const user = await User.findById(id); if (!user) throw new NotFoundError('User not found'); return safeUser(user); },
  async patch(id: string, actorId: string, input: { name?: string; role?: 'admin' | 'assistant'; permissions?: PermissionKey[] }, logger: pino.Logger) {
    const user = await User.findById(id);
    if (!user) throw new NotFoundError('User not found');
    if (actorId === id && input.role && input.role !== user.role) throw new ForbiddenError('You cannot change your own role');
    if (input.role && input.role !== user.role && user.role === 'admin' && user.isActive) await this.assertAnotherAdmin(id);
    const beforeRole = user.role;
    const beforePermissions = Object.entries(user.permissions ?? {}).filter(([, enabled]) => enabled).map(([key]) => key).sort();
    if (input.name !== undefined) user.name = input.name;
    if (input.role !== undefined && input.role !== user.role) {
      user.role = input.role;
      const defaults = input.role === 'admin' ? rolePermissionDefaults.admin : rolePermissionDefaults.assistant;
      for (const key of Object.keys(user.permissions ?? {})) user.permissions[key] = (defaults as readonly string[]).includes(key);
    }
    if (input.permissions !== undefined && user.role === 'assistant') {
      const all = Object.keys(user.permissions ?? {});
      for (const key of all) user.permissions[key] = input.permissions.includes(key as PermissionKey);
    }
    if (user.role === 'admin') for (const key of Object.keys(user.permissions ?? {})) user.permissions[key] = true;
    await user.save();
    if (beforeRole !== user.role) await writeAudit({ actorId, action: 'user.role_changed', entityType: 'user', entityId: id, beforeStatus: beforeRole, afterStatus: user.role }, logger);
    const afterPermissions = Object.entries(user.permissions ?? {}).filter(([, enabled]) => enabled).map(([key]) => key).sort();
    if (JSON.stringify(beforePermissions) !== JSON.stringify(afterPermissions)) await writeAudit({ actorId, action: 'user.permissions_changed', entityType: 'user', entityId: id, beforeStatus: beforePermissions.join(','), afterStatus: afterPermissions.join(',') }, logger);
    return safeUser(user);
  },
  async deactivate(id: string, actorId: string, logger: pino.Logger) {
    if (id === actorId) throw new ForbiddenError('You cannot deactivate yourself');
    const user = await User.findById(id);
    if (!user) throw new NotFoundError('User not found');
    if (user.isActive && user.role === 'admin') await this.assertAnotherAdmin(id);
    if (!user.isActive) return safeUser(user);
    user.isActive = false; user.tokenVersion += 1;
    await user.save();
    await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await writeAudit({ actorId, action: 'user.deactivated', entityType: 'user', entityId: id, beforeStatus: 'active', afterStatus: 'inactive' }, logger);
    return safeUser(user);
  },
  async reactivate(id: string, actorId: string, logger: pino.Logger) {
    const user = await User.findById(id);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isActive) { user.isActive = true; await user.save(); await writeAudit({ actorId, action: 'user.reactivated', entityType: 'user', entityId: id, beforeStatus: 'inactive', afterStatus: 'active' }, logger); }
    return safeUser(user);
  },
  async assertAnotherAdmin(excludedId: string) {
    const count = await User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: new mongoose.Types.ObjectId(excludedId) } });
    if (count < 1) throw new ConflictError('The last active Admin cannot be demoted or deactivated');
  },
};
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
