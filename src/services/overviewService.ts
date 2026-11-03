import type { PipelineStage, Types } from 'mongoose';
import { cairoDayRange } from '../lib/time';
import { Enrollment } from '../models/Enrollment';
import { Course } from '../models/Course';
import { Payment } from '../models/Payment';
import type { OverviewQuery } from '../shared/schemas/overview';

type CourseOverview = { id: Types.ObjectId; title: string; registrations: number; paid: number; revenue: number };

function rangeMatch(query: OverviewQuery): Record<string, unknown> {
  const range = cairoDayRange(query.from, query.to);
  if (!range.from && !range.to) return {};
  return { registeredAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } };
}
function paymentRangeMatch(query: OverviewQuery): Record<string, unknown> {
  const range = cairoDayRange(query.from, query.to);
  return { status: 'confirmed', currency: 'EGP', ...(range.from || range.to ? { receivedAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } } : {}) };
}

export const overviewService = {
  async get(query: OverviewQuery) {
    const match = rangeMatch(query);
    const [overall, grouped, revenueRows, totalRows] = await Promise.all([
      Enrollment.aggregate<{ registrations: number; paid: number; unpaid: number }>([
        { $match: match },
        { $group: { _id: null, registrations: { $sum: 1 }, paid: { $sum: { $cond: [{ $eq: ['$paymentSummary.status', 'paid'] }, 1, 0] } }, unpaid: { $sum: { $cond: [{ $and: [{ $ne: ['$enrollmentStatus', 'cancelled'] }, { $ne: ['$paymentSummary.status', 'paid'] }] }, 1, 0] } } } },
      ]),
      Enrollment.aggregate<CourseOverview>([
        { $match: match },
        { $group: { _id: '$courseId', snapshotTitle: { $first: '$courseSnapshot.title.ar' }, registrations: { $sum: 1 }, paid: { $sum: { $cond: [{ $eq: ['$paymentSummary.status', 'paid'] }, 1, 0] } } } },
        { $lookup: { from: Course.collection.name, localField: '_id', foreignField: '_id', as: 'course' } },
        { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, id: '$_id', title: { $ifNull: ['$course.draft.details.title.ar', { $ifNull: ['$course.published.details.title.ar', { $ifNull: ['$snapshotTitle', ''] }] }] }, registrations: 1, paid: 1 } },
        { $sort: { title: 1, id: 1 } },
      ]),
      Payment.aggregate<{ revenue: number }>([
        { $match: paymentRangeMatch(query) },
        { $group: { _id: null, revenue: { $sum: { $cond: [{ $eq: ['$kind', 'payment'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
      ]),
      Enrollment.aggregate<{ total: number }>([{ $count: 'total' }]),
    ]);

    const courseRevenue = await Payment.aggregate<{ _id: Types.ObjectId; revenue: number }>([
      { $match: paymentRangeMatch(query) },
      { $lookup: { from: Enrollment.collection.name, localField: 'enrollmentId', foreignField: '_id', as: 'enrollment' } },
      { $unwind: '$enrollment' },
      ...(Object.keys(rangeMatch(query)).length ? [{ $match: { 'enrollment.registeredAt': rangeMatch(query).registeredAt } } as PipelineStage] : []),
      { $group: { _id: '$enrollment.courseId', revenue: { $sum: { $cond: [{ $eq: ['$kind', 'payment'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
    ]);
    const revenues = new Map(courseRevenue.map((row) => [String(row._id), row.revenue]));
    const courses = grouped.map((course) => ({ id: String(course.id), title: course.title, registrations: course.registrations, paid: course.paid, revenue: revenues.get(String(course.id)) ?? 0, currency: 'EGP' }));
    const periodRevenue = revenueRows[0]?.revenue ?? 0;
    const count = overall[0] ?? { registrations: 0, paid: 0, unpaid: 0 };
    return { from: query.from ?? '', to: query.to ?? '', totalRegistrations: totalRows[0]?.total ?? 0, registrations: count.registrations, paid: count.paid, unpaid: count.unpaid, netRevenue: periodRevenue, courses };
  },
};
