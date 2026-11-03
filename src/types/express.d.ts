import type { PermissionKey } from '../shared/schemas/permissions';

export interface AuthActor {
  id: string;
  name: { ar: string; en?: string };
  email: string;
  role: 'admin' | 'assistant';
  permissions: PermissionKey[];
}

declare global {
  namespace Express {
    interface Request { auth?: AuthActor }
  }
}

export {};
