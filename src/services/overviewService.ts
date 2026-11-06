import type { PipelineStage, Types } from 'mongoose';
import { cairoDayRange } from '../lib/time';
import { Enrollment } from '../models/Enrollment';
import { Course } from '../models/Course';
import { Payment } from '../models/Payment';
import { overviewStartsInFuture, type OverviewQuery } from '../shared/schemas/overview';

type Currency = string;
type CourseOverview = { id: Types.ObjectId; title: string; registrations: number; paid: number };
const legacyCurrencies: Currency[] = ['EGP', 'USD'];

function rangeMatch(query: OverviewQuery): Record<string, unknown> {
  if (overviewStartsInFuture(query)) return { _id: { $exists: false } };
  const range = cairoDayRange(query.from, query.to);
  if (!range.from && !range.to) return {};
  return { registeredAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } };
}
function paymentRangeMatch(query: OverviewQuery): Record<string, unknown> {
  if (overviewStartsInFuture(query)) return { _id: { $exists: false } };
  const range = cairoDayRange(query.from, query.to);
  return { status: 'confirmed', ...(range.from || range.to ? { receivedAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } } : {}) };
}
function minorNetExpression() {
  return { $cond: [{ $eq: ['$kind', 'payment'] }, '$amount', { $multiply: ['$amount', -1] }] };
}

export const overviewService = {
  async get(query: OverviewQuery) {
    const match = rangeMatch(query);
    const [overall, grouped, revenueRows, totalRows, currencyCounts] = await Promise.all([
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
      Payment.aggregate<{ _id: Currency; revenue: number }>([
        { $match: paymentRangeMatch(query) },
        { $group: { _id: '$currency', revenue: { $sum: minorNetExpression() } } },
      ]),
      Enrollment.aggregate<{ total: number }>([{ $count: 'total' }]),
      Enrollment.aggregate<{ _id: Currency; paid: number; unpaid: number }>([
        { $match: match },
        { $group: { _id: { $ifNull: ['$priceSnapshot.currency', 'EGP'] }, paid: { $sum: { $cond: [{ $eq: ['$paymentSummary.status', 'paid'] }, 1, 0] } }, unpaid: { $sum: { $cond: [{ $and: [{ $ne: ['$enrollmentStatus', 'cancelled'] }, { $ne: ['$paymentSummary.status', 'paid'] }] }, 1, 0] } } } },
      ]),
    ]);

    const courseRevenue = await Payment.aggregate<{ _id: { courseId: Types.ObjectId; currency: Currency }; revenue: number }>([
      { $match: paymentRangeMatch(query) },
      { $lookup: { from: Enrollment.collection.name, localField: 'enrollmentId', foreignField: '_id', as: 'enrollment' } },
      { $unwind: '$enrollment' },
      ...(Object.keys(match).length ? [{ $match: { 'enrollment.registeredAt': match.registeredAt } } as PipelineStage] : []),
      { $group: { _id: { courseId: '$enrollment.courseId', currency: '$currency' }, revenue: { $sum: minorNetExpression() } } },
    ]);
    const revenues = new Map(courseRevenue.map((row) => [`${String(row._id.courseId)}:${row._id.currency}`, row.revenue]));
    const courses = grouped.map((course) => {
      const netByCurrency = { EGP: revenues.get(`${String(course.id)}:EGP`) ?? 0, USD: revenues.get(`${String(course.id)}:USD`) ?? 0 };
      return { id: String(course.id), title: course.title, registrations: course.registrations, paid: course.paid, revenue: netByCurrency.EGP, currency: 'EGP', netByCurrency };
    });
    const amounts = new Map(revenueRows.map((row) => [row._id, row.revenue]));
    const counts = new Map(currencyCounts.map((row) => [row._id, row]));
    const currencies = [...new Set([...legacyCurrencies, ...amounts.keys(), ...counts.keys()])].sort((a, b) => legacyCurrencies.indexOf(a) - legacyCurrencies.indexOf(b) || a.localeCompare(b));
    const revenueByCurrency = currencies.map((currency) => ({ currency, netRevenue: amounts.get(currency) ?? 0, paidCount: counts.get(currency)?.paid ?? 0, unpaidCount: counts.get(currency)?.unpaid ?? 0 }));
    const count = overall[0] ?? { registrations: 0, paid: 0, unpaid: 0 };
    return { from: query.from ?? '', to: query.to ?? '', totalRegistrations: totalRows[0]?.total ?? 0, registrations: count.registrations, paid: count.paid, unpaid: count.unpaid, netRevenue: amounts.get('EGP') ?? 0, revenueByCurrency, courses };
  },
};
