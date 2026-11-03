import mongoose, { type PipelineStage } from 'mongoose';
import type pino from 'pino';
import { ForbiddenError, ValidationError } from '../lib/errors';
import { cairoDayRange } from '../lib/time';
import { Enrollment } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { User } from '../models/User';
import type { AuthActor } from '../types/express';
import type { enrollmentListQuerySchema } from '../shared/schemas/staffRecords';
import type { z } from 'zod';
import { writeAudit } from './audit';
import { hasPermission as roleHasPermission } from '../shared/schemas/permissions';

export const ENROLLMENT_EXPORT_MAX_ROWS = 10_000;
type ExportQuery = z.infer<typeof enrollmentListQuerySchema>;
type ExportRow = {
  reference: string; lead: { fullName: string; email: string; phone: string }; courseTitle: string;
  enrollmentStatus: string; followUpStatus: string; assignedTo: string | null; registeredAt: Date;
  priceSnapshot: { amount: number | null; currency: string };
  paymentSummary: { netMinor: number; status: string; lastPaymentAt: Date | null };
};

function canSeePaymentDetails(actor: AuthActor): boolean { return roleHasPermission(actor, 'viewPayments'); }

export function assertEnrollmentExportLimit(total: number, maxRows = ENROLLMENT_EXPORT_MAX_ROWS): void {
  if (total > maxRows) throw new ValidationError(`التصدير تجاوز الحد الأقصى وهو ${maxRows} سجل.`, [{ field: 'maxRows', total, maxRows }]);
}

function pipelineFor(query: ExportQuery, actor: AuthActor): PipelineStage[] {
  if ((query.paymentStatus || query.sort === 'paymentStatus') && !canSeePaymentDetails(actor)) throw new ForbiddenError('فلترة الدفع مش متاحة لحسابك.');
  const match: Record<string, unknown> = {};
  if (query.courseId) match.courseId = new mongoose.Types.ObjectId(query.courseId);
  if (query.enrollmentStatus) match.enrollmentStatus = query.enrollmentStatus;
  if (query.followUpStatus) match.followUpStatus = query.followUpStatus;
  if (query.paymentStatus) match['paymentSummary.status'] = query.paymentStatus;
  if (query.assignedTo === 'me') match.assignedTo = new mongoose.Types.ObjectId(actor.id);
  else if (query.assignedTo === 'unassigned') match.assignedTo = null;
  else if (query.assignedTo) match.assignedTo = new mongoose.Types.ObjectId(query.assignedTo);
  const dateRange = cairoDayRange(query.dateFrom, query.dateTo);
  if (dateRange.from || dateRange.to) match.registeredAt = { ...(dateRange.from ? { $gte: dateRange.from } : {}), ...(dateRange.to ? { $lte: dateRange.to } : {}) };
  const stages: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: Lead.collection.name, localField: 'leadId', foreignField: '_id', as: 'lead' } },
    { $unwind: '$lead' },
  ];
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    stages.push({ $match: { $or: [
      { reference: { $regex: escaped, $options: 'i' } }, { 'lead.fullName': { $regex: escaped, $options: 'i' } },
      { 'lead.email': { $regex: escaped, $options: 'i' } }, { 'lead.phone': { $regex: escaped, $options: 'i' } },
    ] } });
  }
  const sort = query.sort === 'oldest' ? { registeredAt: 1 as const, _id: 1 as const }
    : query.sort === 'name' ? { 'lead.fullName': 1 as const, _id: 1 as const }
      : query.sort === 'course' ? { 'courseSnapshot.title.ar': 1 as const, _id: 1 as const }
        : query.sort === 'paymentStatus' ? { 'paymentSummary.status': 1 as const, registeredAt: -1 as const, _id: -1 as const }
          : { registeredAt: -1 as const, _id: -1 as const };
  stages.push({ $sort: sort });
  return stages;
}

export async function prepareEnrollmentExport(query: ExportQuery, actor: AuthActor) {
  if (actor.role !== 'admin') throw new ForbiddenError('تصدير البيانات متاح للمسؤول بس.');
  const base = pipelineFor(query, actor);
  const [countResult] = await Enrollment.aggregate<{ total: number }>([...base, { $count: 'total' }]);
  const total = countResult?.total ?? 0;
  assertEnrollmentExportLimit(total);
  const cursor = Enrollment.aggregate<ExportRow>([
    ...base,
    { $lookup: { from: User.collection.name, localField: 'assignedTo', foreignField: '_id', as: 'assignee' } },
    { $unwind: { path: '$assignee', preserveNullAndEmptyArrays: true } },
    { $project: {
      reference: 1, lead: { fullName: '$lead.fullName', email: '$lead.email', phone: '$lead.phone' },
      courseTitle: '$courseSnapshot.title.ar', enrollmentStatus: 1, followUpStatus: 1,
      assignedTo: '$assignee.name', registeredAt: 1, priceSnapshot: 1, paymentSummary: 1,
    } },
  ]).cursor({ batchSize: 500 });
  return { total, cursor, includePayments: canSeePaymentDetails(actor) };
}

export async function auditEnrollmentExport(query: ExportQuery, rowCount: number, actor: AuthActor, logger: pino.Logger) {
  const filters = {
    ...(query.courseId ? { courseId: query.courseId } : {}), ...(query.enrollmentStatus ? { enrollmentStatus: query.enrollmentStatus } : {}),
    ...(query.followUpStatus ? { followUpStatus: query.followUpStatus } : {}), ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.assignedTo ? { assignedTo: query.assignedTo === 'me' ? 'current-user' : query.assignedTo === 'unassigned' ? 'unassigned' : 'specific-user' } : {}),
    ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}), ...(query.dateTo ? { dateTo: query.dateTo } : {}),
    ...(query.search ? { searchProvided: true } : {}), sort: query.sort,
  };
  await writeAudit({ actorId: actor.id, action: 'enrollments_exported', entityType: 'enrollment_export', entityId: actor.id, note: JSON.stringify({ filters, rowCount }) }, logger);
}
