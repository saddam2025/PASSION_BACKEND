import { z } from 'zod';

export const PermissionKey = {
  viewLeads: 'viewLeads',
  updateFollowUp: 'updateFollowUp',
  viewPayments: 'viewPayments',
  recordPayments: 'recordPayments',
  exportCsv: 'exportCsv',
  viewFinancialReports: 'viewFinancialReports',
  manageNotes: 'manageNotes',
  viewSettings: 'viewSettings',
} as const;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];
export const PermissionKeySchema = z.enum([
  PermissionKey.viewLeads,
  PermissionKey.updateFollowUp,
  PermissionKey.viewPayments,
  PermissionKey.recordPayments,
  PermissionKey.exportCsv,
  PermissionKey.viewFinancialReports,
  PermissionKey.manageNotes,
  PermissionKey.viewSettings,
]);
export const PermissionListSchema = z.array(PermissionKeySchema).max(8);
export const permissionCatalog: Record<
  PermissionKey,
  { labelKey: string; descriptionKey: string }
> = {
  viewLeads: {
    labelKey: 'permissions.viewLeads',
    descriptionKey: 'permissions.viewLeadsDescription',
  },
  updateFollowUp: {
    labelKey: 'permissions.updateFollowUp',
    descriptionKey: 'permissions.updateFollowUpDescription',
  },
  viewPayments: {
    labelKey: 'permissions.viewPayments',
    descriptionKey: 'permissions.viewPaymentsDescription',
  },
  recordPayments: {
    labelKey: 'permissions.recordPayments',
    descriptionKey: 'permissions.recordPaymentsDescription',
  },
  exportCsv: {
    labelKey: 'permissions.exportCsv',
    descriptionKey: 'permissions.exportCsvDescription',
  },
  viewFinancialReports: {
    labelKey: 'permissions.viewFinancialReports',
    descriptionKey: 'permissions.viewFinancialReportsDescription',
  },
  manageNotes: {
    labelKey: 'permissions.manageNotes',
    descriptionKey: 'permissions.manageNotesDescription',
  },
  viewSettings: {
    labelKey: 'permissions.viewSettings',
    descriptionKey: 'permissions.viewSettingsDescription',
  },
};
export const rolePermissionDefaults = {
  admin: Object.keys(PermissionKey) as PermissionKey[],
  assistant: ['viewLeads', 'updateFollowUp', 'viewPayments', 'recordPayments', 'manageNotes'] as PermissionKey[],
} as const;
export interface PermissionUser {
  id: string;
  role: 'admin' | 'assistant';
  permissions: readonly PermissionKey[];
}
export function hasPermission(user: PermissionUser, key: PermissionKey): boolean {
  return user.role === 'admin' || rolePermissionDefaults.assistant.includes(key);
}
