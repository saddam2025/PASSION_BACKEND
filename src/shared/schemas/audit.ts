export const auditActions = [
  'course.created',
  'course.details_saved',
  'course.published_directly',
  'course.unpublished',
  'course.archived',
  'course.unarchived',
  'course.deleted',
  'course.rolled_back',
  'revision.created',
  'revision.saved',
  'revision.submitted',
  'revision.approved',
  'revision.rejected',
  'revision.reopened',
  'lead.created',
  'lead.updated',
  'enrollment.created',
  'enrollment.follow_up_changed',
  'enrollment.assigned',
  'enrollment.confirmed',
  'enrollment.cancelled',
  'enrollment.note_added',
  'enrollment.note_deleted',
  'enrollment.contact_logged',
  'payment.recorded',
  'payment.confirmed',
  'payment.voided',
  'payment.refunded',
  'user.permissions_changed',
  'user.role_changed',
  'user.deactivated',
  'user.reactivated',
  'user.password_reset_link',
  'invite.created',
  'invite.resent',
  'invite.revoked',
  'invite.deleted',
  'invite.accepted',
  'settings.updated',
  'notification.read',
  'notification.read_all',
  'auth.login_failed',
  'auth.login_succeeded',
  'export.csv',
] as const;
export type AuditAction = (typeof auditActions)[number];
export const auditActionLabelKeys: Record<AuditAction, string> = Object.fromEntries(
  auditActions.map((action) => [action, `actions.${action.replaceAll('.', '_')}`]),
) as Record<AuditAction, string>;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(password|token|secret|authorization)/i.test(key))
        .map(([key, item]) => [key, redact(item)]),
    );
  return value;
}
