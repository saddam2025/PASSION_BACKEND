import mongoose, { type PipelineStage } from 'mongoose';
import type pino from 'pino';
import { cairoDayRange } from '../lib/time';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { Enrollment } from '../models/Enrollment';
import type { EnrollmentDocument } from '../models/Enrollment';
import { Lead } from '../models/Lead';
import { Note } from '../models/Note';
import { Notification } from '../models/Notification';
import { Payment } from '../models/Payment';
import { User } from '../models/User';
import type { AuthActor } from '../types/express';
import type { z } from 'zod';
import type { enrollmentListQuerySchema, listNotesQuerySchema, notificationListQuerySchema } from '../shared/schemas/staffRecords';
import { writeAudit } from './audit';
import { hasPermission as roleHasPermission } from '../shared/schemas/permissions';
import { refreshEnrollmentPaymentSummary } from './paymentsService';

type EnrollmentListQuery = z.infer<typeof enrollmentListQuerySchema>;
type NotesListQuery = z.infer<typeof listNotesQuerySchema>;
type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
type MutableEnrollment = mongoose.HydratedDocument<EnrollmentDocument>;

function id(value: unknown): string { return value == null ? '' : String(value); }
function arabicName(value: unknown): { ar: string } {
  if (typeof value === 'string') return { ar: value };
  if (value && typeof value === 'object' && 'ar' in value && typeof value.ar === 'string') return { ar: value.ar };
  return { ar: '' };
}
function plainText(value: string): string {
  // eslint-disable-next-line no-control-regex -- Remove non-printing controls before saving internal notes.
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/<[^>]*>/g, '').trim();
}
function requireObjectId(value: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(value)) throw new NotFoundError('السجل ده مش موجود.');
  return new mongoose.Types.ObjectId(value);
}
function safeAssignee(user: { _id: unknown; name: string } | null | undefined) {
  return user ? { id: id(user._id), name: { ar: user.name } } : null;
}
function statusValue(value: unknown): string { return typeof value === 'string' ? value : ''; }

export const staffRecordsService = {
  async enrollmentFilters(actor: AuthActor) {
    if (!roleHasPermission(actor, 'viewLeads')) throw new ForbiddenError('عرض التسجيلات مش متاح لحسابك.');
    const courses = await Enrollment.aggregate<{ id: string; title: string }>([
      { $lookup: { from: Lead.collection.name, localField: 'leadId', foreignField: '_id', as: 'visibleLead' } },
      { $unwind: '$visibleLead' },
      { $sort: { 'courseSnapshot.title.ar': 1, courseId: 1 } },
      { $group: { _id: '$courseId', title: { $first: '$courseSnapshot.title.ar' } } },
      { $sort: { title: 1, _id: 1 } },
      { $project: { _id: 0, id: { $toString: '$_id' }, title: { $ifNull: ['$title', ''] } } },
    ]);
    return { courses };
  },

  async listEnrollments(query: EnrollmentListQuery, actor: AuthActor) {
    const canSeePayments = roleHasPermission(actor, 'viewPayments');
    if ((query.paymentStatus || query.sort === 'paymentStatus') && !canSeePayments) throw new ForbiddenError('عرض حالة الدفع مش متاح لحسابك.');
    const match: Record<string, unknown> = {};
    if (query.courseId) match.courseId = new mongoose.Types.ObjectId(query.courseId);
    if (query.enrollmentStatus) match.enrollmentStatus = query.enrollmentStatus;
    if (query.followUpStatus) match.followUpStatus = query.followUpStatus;
    if (query.paymentStatus) match['paymentSummary.status'] = query.paymentStatus;
    if (query.assignedTo === 'me') match.assignedTo = new mongoose.Types.ObjectId(actor.id);
    else if (query.assignedTo === 'unassigned') match.assignedTo = null;
    else if (query.assignedTo) match.assignedTo = new mongoose.Types.ObjectId(query.assignedTo);
    const dateRange = cairoDayRange(query.dateFrom, query.dateTo);
    if (dateRange.from || dateRange.to) {
      match.registeredAt = { ...(dateRange.from ? { $gte: dateRange.from } : {}), ...(dateRange.to ? { $lte: dateRange.to } : {}) };
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $lookup: { from: Lead.collection.name, localField: 'leadId', foreignField: '_id', as: 'lead' } },
      { $unwind: '$lead' },
    ];
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pipeline.push({ $match: { $or: [
        { reference: { $regex: escaped, $options: 'i' } },
        { 'lead.fullName': { $regex: escaped, $options: 'i' } },
        { 'lead.email': { $regex: escaped, $options: 'i' } },
        { 'lead.phone': { $regex: escaped, $options: 'i' } },
      ] } });
    }
    const sort = query.sort === 'oldest'
      ? { registeredAt: 1 as const, _id: 1 as const }
      : query.sort === 'name'
        ? { 'lead.fullName': 1 as const, _id: 1 as const }
        : query.sort === 'course'
          ? { 'courseSnapshot.title.ar': 1 as const, _id: 1 as const }
          : query.sort === 'paymentStatus'
            ? { 'paymentSummary.status': 1 as const, registeredAt: -1 as const, _id: -1 as const }
          : { registeredAt: -1 as const, _id: -1 as const };
    pipeline.push(
      { $sort: sort },
      { $facet: {
        items: [
          { $skip: (query.page - 1) * query.pageSize },
          { $limit: query.pageSize },
          { $lookup: { from: User.collection.name, localField: 'assignedTo', foreignField: '_id', as: 'assignee' } },
          { $unwind: { path: '$assignee', preserveNullAndEmptyArrays: true } },
          { $project: {
            _id: 1, reference: 1,
            lead: { fullName: '$lead.fullName', email: '$lead.email', phone: '$lead.phone' },
            courseTitle: '$courseSnapshot.title', priceSnapshot: 1,
            enrollmentStatus: 1, followUpStatus: 1,
            paymentSummary: 1,
            assignedTo: { _id: '$assignee._id', name: '$assignee.name' }, registeredAt: 1,
          } },
        ],
        total: [{ $count: 'value' }],
      } },
    );
    const [result] = await Enrollment.aggregate<{ items: Array<Record<string, unknown>>; total: Array<{ value: number }> }>(pipeline);
    const items = (result?.items ?? []).map((item) => {
      const assignee = item.assignedTo as { _id?: unknown; name?: string } | null;
      return {
        id: id(item._id),
        reference: item.reference,
        lead: item.lead,
        courseTitle: arabicName(item.courseTitle),
        priceSnapshot: item.priceSnapshot,
        enrollmentStatus: item.enrollmentStatus,
        followUpStatus: item.followUpStatus,
        ...(canSeePayments ? { paymentSummary: { ...(item.paymentSummary as Record<string, unknown> | undefined ?? { netMinor: 0, status: 'unpaid', lastPaymentAt: null }), currency: (item.priceSnapshot as { currency?: string } | undefined)?.currency ?? 'EGP' } } : {}),
        assignedTo: assignee?.name ? { id: id(assignee._id), name: { ar: assignee.name } } : null,
        registeredAt: item.registeredAt,
      };
    });
    return { items, total: result?.total[0]?.value ?? 0, page: query.page, pageSize: query.pageSize };
  },

  async getEnrollment(idValue: string, actor?: AuthActor) {
    const enrollmentId = requireObjectId(idValue);
    const enrollment = await Enrollment.findById(enrollmentId).lean();
    if (!enrollment) throw new NotFoundError('السجل ده مش موجود.');
    const lead = await Lead.findById(enrollment.leadId).select('fullName email phone phoneNormalized possibleDuplicateOf').lean();
    if (!lead) throw new NotFoundError('السجل ده مش موجود.');
    const [assignee, otherEnrollments, duplicateEnrollments, notes, actors] = await Promise.all([
      enrollment.assignedTo ? User.findById(enrollment.assignedTo).select('_id name').lean() : null,
      Enrollment.find({ leadId: enrollment.leadId, _id: { $ne: enrollment._id } }).select('reference').sort({ registeredAt: -1 }).lean(),
      lead.possibleDuplicateOf ? Enrollment.find({ leadId: lead.possibleDuplicateOf }).select('reference').sort({ registeredAt: -1 }).lean() : [],
      Note.find({ enrollmentId }).sort({ createdAt: -1 }).limit(100).lean(),
      User.find({ _id: { $in: enrollment.history.map((entry) => entry.by) } }).select('_id name').lean(),
    ]);
    const actorNames = new Map(actors.map((user) => [id(user._id), user.name]));
    const history = enrollment.history.map((event) => ({
      at: event.at,
      by: { id: id(event.by), name: { ar: actorNames.get(id(event.by)) ?? 'النظام' } },
      from: event.from ?? null,
      to: event.to ?? null,
      note: event.note ?? null,
    }));
    const noteAuthors = await User.find({ _id: { $in: notes.map((note) => note.authorId) } }).select('_id name').lean();
    const noteAuthorNames = new Map(noteAuthors.map((user) => [id(user._id), user.name]));
    return {
      id: id(enrollment._id),
      reference: enrollment.reference,
      lead: { id: id(lead._id), fullName: lead.fullName, email: lead.email, phone: lead.phone, phoneNormalized: lead.phoneNormalized },
      courseSnapshot: { title: arabicName(enrollment.courseSnapshot?.title), slug: enrollment.courseSnapshot?.slug },
      priceSnapshot: enrollment.priceSnapshot,
      ...(actor && roleHasPermission(actor, 'viewPayments') ? { paymentSummary: { ...(enrollment.paymentSummary ?? { netMinor: 0, status: 'unpaid', lastPaymentAt: null }), currency: enrollment.priceSnapshot?.currency ?? 'EGP' } } : {}),
      formSnapshot: enrollment.formSnapshot,
      answers: enrollment.answers instanceof Map ? Object.fromEntries(enrollment.answers) : enrollment.answers,
      enrollmentStatus: enrollment.enrollmentStatus,
      followUpStatus: enrollment.followUpStatus,
      isActive: enrollment.isActive,
      assignedTo: safeAssignee(assignee),
      cancelledReason: enrollment.cancelledReason ?? null,
      registeredAt: enrollment.registeredAt,
      history,
      notes: notes.map((note) => ({ id: id(note._id), body: note.body, createdAt: note.createdAt, author: { id: id(note.authorId), name: { ar: noteAuthorNames.get(id(note.authorId)) ?? '' } } })),
      otherEnrollments: otherEnrollments.map((item) => ({ reference: item.reference })),
      possibleDuplicateOf: { hasPossibleDuplicate: Boolean(lead.possibleDuplicateOf), references: duplicateEnrollments.map((item) => item.reference) },
    };
  },

  async getLead(idValue: string) {
    const leadId = requireObjectId(idValue);
    const lead = await Lead.findById(leadId).select('fullName email phone phoneNormalized possibleDuplicateOf').lean();
    if (!lead) throw new NotFoundError('السجل ده مش موجود.');
    const [enrollments, duplicateEnrollments] = await Promise.all([
      Enrollment.find({ leadId }).sort({ registeredAt: -1 }).lean(),
      lead.possibleDuplicateOf ? Enrollment.find({ leadId: lead.possibleDuplicateOf }).select('reference').sort({ registeredAt: -1 }).lean() : [],
    ]);
    return {
      lead: { id: id(lead._id), fullName: lead.fullName, email: lead.email, phone: lead.phone, phoneNormalized: lead.phoneNormalized },
      counts: { leads: 1, enrollments: enrollments.length },
      enrollments: enrollments.map((item) => ({ id: id(item._id), reference: item.reference, courseTitle: arabicName(item.courseSnapshot?.title), enrollmentStatus: item.enrollmentStatus, followUpStatus: item.followUpStatus, registeredAt: item.registeredAt })),
      possibleDuplicateOf: { hasPossibleDuplicate: Boolean(lead.possibleDuplicateOf), references: duplicateEnrollments.map((item) => item.reference) },
    };
  },

  async updateFollowUp(idValue: string, actor: AuthActor, input: { followUpStatus: EnrollmentDocument['followUpStatus']; note?: string }, logger: pino.Logger) {
    const enrollment = await findEnrollment(idValue);
    const before = statusValue(enrollment.followUpStatus);
    // Treat repeating the current status as a successful no-op. This keeps retries
    // and clients that resend the selected value idempotent without creating a
    // duplicate history entry or audit event.
    if (before === input.followUpStatus) return this.getEnrollment(idValue, actor);
    enrollment.followUpStatus = input.followUpStatus;
    enrollment.history.push({ at: new Date(), by: new mongoose.Types.ObjectId(actor.id), from: before, to: input.followUpStatus, ...(input.note ? { note: plainText(input.note).slice(0, 1_000) } : {}) });
    await enrollment.save();
    await writeAudit({ actorId: actor.id, action: 'enrollment.follow_up_changed', entityType: 'enrollment', entityId: idValue, beforeStatus: before, afterStatus: input.followUpStatus }, logger);
    return this.getEnrollment(idValue, actor);
  },

  async assign(idValue: string, actor: AuthActor, assigneeId: string | null, logger: pino.Logger) {
    ensureAdmin(actor);
    const enrollment = await findEnrollment(idValue);
    ensureNotCancelled(enrollment);
    let assignee: { _id: mongoose.Types.ObjectId; name: string } | null = null;
    if (assigneeId) {
      assignee = await User.findOne({ _id: requireObjectId(assigneeId), isActive: true, role: { $in: ['admin', 'assistant'] } }).select('_id name').lean();
      if (!assignee) throw new ValidationError('اختار عضو فريق نشط.', [{ field: 'assigneeId' }]);
    }
    const previous = enrollment.assignedTo ? id(enrollment.assignedTo) : '';
    const next = assignee ? id(assignee._id) : '';
    if (previous === next) throw new ConflictError('التعيين ده موجود بالفعل.');
    enrollment.assignedTo = assignee?._id ?? null;
    enrollment.history.push({ at: new Date(), by: new mongoose.Types.ObjectId(actor.id), from: previous, to: next, note: 'تحديث التعيين' });
    await enrollment.save();
    await writeAudit({ actorId: actor.id, action: 'enrollment.assigned', entityType: 'enrollment', entityId: idValue, beforeStatus: previous || 'unassigned', afterStatus: next || 'unassigned' }, logger);
    return this.getEnrollment(idValue, actor);
  },

  async confirm(idValue: string, actor: AuthActor, reason: string | undefined, logger: pino.Logger) {
    ensureAdmin(actor);
    const enrollment = await findEnrollment(idValue);
    if (enrollment.enrollmentStatus !== 'pending') throw new ConflictError('التسجيل لازم يكون قيد الانتظار عشان يتأكد.');
    const hasConfirmedPayment = await Payment.exists({ enrollmentId: enrollment._id, status: 'confirmed' });
    const cleanReason = reason ? plainText(reason).slice(0, 1_000) : '';
    if (!hasConfirmedPayment && cleanReason.length < 3) throw new ValidationError('سبب تأكيد التسجيل من غير دفع مطلوب.', [{ field: 'reason' }]);
    const before = statusValue(enrollment.enrollmentStatus);
    enrollment.enrollmentStatus = 'confirmed';
    enrollment.history.push({ at: new Date(), by: new mongoose.Types.ObjectId(actor.id), from: before, to: 'confirmed', ...(cleanReason ? { note: cleanReason } : {}) });
    await enrollment.save();
    await writeAudit({ actorId: actor.id, action: 'enrollment.confirmed', entityType: 'enrollment', entityId: idValue, beforeStatus: before, afterStatus: 'confirmed' }, logger);
    return this.getEnrollment(idValue, actor);
  },

  async cancel(idValue: string, actor: AuthActor, reason: string, logger: pino.Logger) {
    ensureAdmin(actor);
    const enrollment = await findEnrollment(idValue);
    if (!['pending', 'confirmed'].includes(String(enrollment.enrollmentStatus))) throw new ConflictError('التسجيل ده ملغي بالفعل.');
    const before = statusValue(enrollment.enrollmentStatus);
    const cleanReason = plainText(reason).slice(0, 1_000);
    if (cleanReason.length < 3) throw new ValidationError('سبب الإلغاء مطلوب.', [{ field: 'reason' }]);
    enrollment.enrollmentStatus = 'cancelled';
    enrollment.cancelledReason = cleanReason;
    enrollment.history.push({ at: new Date(), by: new mongoose.Types.ObjectId(actor.id), from: before, to: 'cancelled', note: cleanReason });
    await enrollment.save();
    await refreshEnrollmentPaymentSummary(enrollment._id);
    await writeAudit({ actorId: actor.id, action: 'enrollment.cancelled', entityType: 'enrollment', entityId: idValue, beforeStatus: before, afterStatus: 'cancelled' }, logger);
    return this.getEnrollment(idValue, actor);
  },

  async logWhatsappContact(idValue: string, actor: AuthActor, logger: pino.Logger) {
    const enrollment = await findEnrollment(idValue);
    const current = statusValue(enrollment.followUpStatus);
    enrollment.history.push({ at: new Date(), by: new mongoose.Types.ObjectId(actor.id), from: current, to: current, note: 'تم فتح واتساب للتواصل، من غير تأكيد إرسال رسالة.' });
    await enrollment.save();
    await writeAudit({ actorId: actor.id, action: 'enrollment.whatsapp_contact_logged', entityType: 'enrollment', entityId: idValue, beforeStatus: current, afterStatus: current }, logger);
    return this.getEnrollment(idValue, actor);
  },

  async listNotes(idValue: string, query: NotesListQuery) {
    const enrollmentId = requireObjectId(idValue);
    if (!await Enrollment.exists({ _id: enrollmentId })) throw new NotFoundError('السجل ده مش موجود.');
    const filter = { enrollmentId };
    const [notes, total] = await Promise.all([
      Note.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
      Note.countDocuments(filter),
    ]);
    const authors = await User.find({ _id: { $in: notes.map((note) => note.authorId) } }).select('_id name').lean();
    const names = new Map(authors.map((user) => [id(user._id), user.name]));
    return { items: notes.map((note) => ({ id: id(note._id), enrollmentId: id(note.enrollmentId), body: note.body, createdAt: note.createdAt, author: { id: id(note.authorId), name: { ar: names.get(id(note.authorId)) ?? '' } } })), total, page: query.page, pageSize: query.pageSize };
  },

  async addNote(idValue: string, actor: AuthActor, input: { body: string }, logger: pino.Logger) {
    const enrollmentId = requireObjectId(idValue);
    if (!await Enrollment.exists({ _id: enrollmentId })) throw new NotFoundError('السجل ده مش موجود.');
    const body = plainText(input.body);
    if (!body || body.length > 2_000) throw new ValidationError('الملاحظة لازم تكون من حرف إلى 2000 حرف.', [{ field: 'body' }]);
    const note = await Note.create({ enrollmentId, authorId: new mongoose.Types.ObjectId(actor.id), body });
    await writeAudit({ actorId: actor.id, action: 'enrollment.note_added', entityType: 'enrollment', entityId: idValue }, logger);
    const author = await User.findById(actor.id).select('_id name').lean();
    return { id: id(note._id), enrollmentId: id(note.enrollmentId), body: note.body, createdAt: note.createdAt, author: safeAssignee(author) };
  },

  async listNotifications(actor: AuthActor, query: NotificationListQuery) {
    const filter: Record<string, unknown> = { recipientId: new mongoose.Types.ObjectId(actor.id) };
    if (query.unreadOnly) filter.readAt = null;
    const [notifications, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
      Notification.countDocuments(filter),
    ]);
    return { items: notifications.map(mapNotification), total, page: query.page, pageSize: query.pageSize };
  },

  async unreadNotificationCount(actor: AuthActor) {
    return { count: await Notification.countDocuments({ recipientId: new mongoose.Types.ObjectId(actor.id), readAt: null }) };
  },

  async markNotificationRead(idValue: string, actor: AuthActor, logger: pino.Logger) {
    const notificationId = requireObjectId(idValue);
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipientId: new mongoose.Types.ObjectId(actor.id) },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!notification) throw new NotFoundError('الإشعار ده مش موجود.');
    await writeAudit({ actorId: actor.id, action: 'notification.read', entityType: 'notification', entityId: idValue }, logger);
    return { notification: mapNotification(notification.toObject()) };
  },

  async markAllNotificationsRead(actor: AuthActor, logger: pino.Logger) {
    await Notification.updateMany({ recipientId: new mongoose.Types.ObjectId(actor.id), readAt: null }, { $set: { readAt: new Date() } });
    await writeAudit({ actorId: actor.id, action: 'notifications.read_all', entityType: 'user', entityId: actor.id }, logger);
    return { updated: true };
  },
};

async function findEnrollment(idValue: string): Promise<MutableEnrollment> {
  const enrollment = await Enrollment.findById(requireObjectId(idValue));
  if (!enrollment) throw new NotFoundError('السجل ده مش موجود.');
  return enrollment as MutableEnrollment;
}

function ensureNotCancelled(enrollment: MutableEnrollment): void {
  if (enrollment.enrollmentStatus === 'cancelled') throw new ConflictError('ما ينفعش تعديل تسجيل ملغي.');
}

function ensureAdmin(actor: AuthActor): void {
  if (actor.role !== 'admin') throw new ForbiddenError('العملية دي متاحة للمسؤول بس.');
}

function mapNotification(notification: Record<string, unknown>) {
  const params = notification.params instanceof Map ? Object.fromEntries(notification.params) : notification.params ?? {};
  return {
    id: id(notification._id),
    type: notification.type,
    params,
    entityType: notification.entityType,
    entityId: id(notification.entityId),
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt,
  };
}
