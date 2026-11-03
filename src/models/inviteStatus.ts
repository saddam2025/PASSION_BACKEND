type InviteStateSource = { expiresAt: Date; usedAt?: Date | null; revokedAt?: Date | null };
export function getInviteStatus(invite: InviteStateSource, now = new Date()): 'accepted' | 'revoked' | 'expired' | 'pending' {
  if (invite.usedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt <= now) return 'expired';
  return 'pending';
}
