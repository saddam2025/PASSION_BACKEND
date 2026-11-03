import { AuditLog } from '../models/AuditLog';
import { User } from '../models/User';
import { cairoDayRange } from '../lib/time';
import { csvDocument, cairoCsvDate } from '../lib/csv';

export async function listAudit(query: { entityType?: string; entityId?: string; actorId?: string; action?: string; dateFrom?: string; dateTo?: string; page: number; pageSize: number }) {
  const range = cairoDayRange(query.dateFrom, query.dateTo); const filter: Record<string, unknown> = {};
  for (const key of ['entityType','entityId','actorId','action'] as const) if (query[key]) filter[key] = query[key];
  if (range.from || range.to) filter.occurredAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) };
  const [rows,total] = await Promise.all([AuditLog.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((query.page-1)*query.pageSize).limit(query.pageSize).lean(), AuditLog.countDocuments(filter)]);
  const actors = await User.find({ _id: { $in: rows.map((row) => row.actorId) } }).select('name').lean(); const names = new Map(actors.map((actor) => [String(actor._id), actor.name ?? '']));
  return { items: rows.map((row) => ({ id: String(row._id), actor: { id: String(row.actorId), name: names.get(String(row.actorId)) ?? '' }, action: row.action, entityType: row.entityType, entityId: String(row.entityId), beforeStatus: row.beforeStatus ?? undefined, afterStatus: row.afterStatus ?? undefined, note: safeNote(row.note ?? undefined), occurredAt: row.occurredAt })), total, page: query.page, pageSize: query.pageSize };
}
function safeNote(note?: string) { if (!note || /(?:bearer\s|eyJ[a-zA-Z0-9_-]{20,}|[A-Fa-f0-9]{64})/.test(note)) return ''; return note.replace(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[محذوف]'); }
export async function exportAudit(query: Omit<Parameters<typeof listAudit>[0], 'page'|'pageSize'>) {
  const first = await listAudit({ ...query, page: 1, pageSize: 100 });
  const limit = Math.min(first.total, 10_000); const all = [...first.items];
  for (let page = 2; all.length < limit; page += 1) {
    const next = await listAudit({ ...query, page, pageSize: Math.min(100, limit - all.length) });
    all.push(...next.items);
  }
  const lines = all.map((item) => [cairoCsvDate(item.occurredAt), item.actor.name, item.action, item.entityType, item.beforeStatus, item.afterStatus, item.note]);
  return { csv: csvDocument(['التاريخ','المستخدم','الإجراء','نوع العنصر','الحالة السابقة','الحالة الحالية','ملاحظة'], lines), total: first.total, truncated: first.total > limit };
}
