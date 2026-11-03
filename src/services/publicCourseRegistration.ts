import mongoose, { type ClientSession } from 'mongoose';
import { Course } from '../models/Course';
import { AppError } from '../lib/errors';

export type PublishedRegistrationCourse = {
  _id: mongoose.Types.ObjectId;
  slug: string;
  status: string;
  deletedAt: Date | null;
  published: {
    details?: Record<string, unknown>;
    form?: unknown;
  } | null;
};

export function tx(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'ar' in value && typeof value.ar === 'string') return value.ar;
  return '';
}

export async function getPublishedForRegistration(slugOrId: string, session?: ClientSession): Promise<PublishedRegistrationCourse> {
  const choices: Record<string, unknown>[] = [{ slug: slugOrId }];
  if (/^[a-f\d]{24}$/i.test(slugOrId)) choices.push({ _id: new mongoose.Types.ObjectId(slugOrId) });
  const query = Course.findOne({ $or: choices, deletedAt: null });
  if (session) query.session(session);
  const course = await query.lean() as unknown as PublishedRegistrationCourse | null;
  if (!course || course.deletedAt || course.status !== 'published' || !course.published) {
    throw new AppError('COURSE_NOT_AVAILABLE', 'الكورس ده مش متاح للتسجيل دلوقتي.', 404);
  }
  return course;
}

export async function assertRegistrationOpen(course: PublishedRegistrationCourse): Promise<void> {
  const details = course.published?.details ?? {};
  const enrollment = details.enrollment as Record<string, unknown> | undefined;
  if (enrollment?.registrationOpen !== true) {
    throw new AppError('REGISTRATION_CLOSED', 'التسجيل في الكورس ده مقفول حاليًا.', 409);
  }
}
