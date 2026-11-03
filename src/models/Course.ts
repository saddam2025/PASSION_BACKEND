import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

// Page section bodies remain Mixed in storage while the service validates the
// complete snapshot against the synchronized Zod schemas.
const snapshotSchema = new Schema({
  details: { type: Schema.Types.Mixed, required: true },
  page: { schemaVersion: { type: Number, required: true }, sections: { type: [Schema.Types.Mixed], default: [] } },
  form: { type: Schema.Types.Mixed, required: true },
  seo: { type: Schema.Types.Mixed, default: {} },
}, { _id: false, strict: 'throw', minimize: false });

const schema = new Schema({
  slug: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  slugHistory: { type: [String], default: [] },
  allSlugs: { type: [String], default: [] },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', required: true },
  featured: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  version: { type: Number, min: 0, default: 0 },
  publishedAt: { type: Date },
  published: { type: snapshotSchema, default: null },
  draft: { type: snapshotSchema, required: true },
  deletedAt: { type: Date, default: null },
}, { ...strictOptions, versionKey: 'version', optimisticConcurrency: true, minimize: false });

schema.index({ slug: 1 }, { unique: true });
schema.index({ allSlugs: 1 }, { unique: true });
schema.index({ status: 1, updatedAt: -1 });
schema.index({ featured: 1, status: 1 });
schema.index({ status: 1, 'draft.details.category': 1, updatedAt: -1 });
schema.index({ status: 1, 'draft.details.category': 1, 'draft.details.title.ar': 1 });
schema.index({ status: 1, 'published.details.category': 1, featured: -1, publishedAt: -1, _id: -1 });
schema.index({ status: 1, featured: -1, publishedAt: -1, _id: -1 });
schema.index({ deletedAt: 1 });
schema.pre(['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany'], function () {
  if (this.getFilter().deletedAt === undefined) this.where({ deletedAt: null });
});
schema.pre('validate', function () {
  this.allSlugs = [...new Set([this.slug, ...this.slugHistory])];
  const bytes = Buffer.byteLength(JSON.stringify(this.toObject({ depopulate: true, versionKey: true })), 'utf8');
  if (bytes > 2 * 1024 * 1024) this.invalidate('draft', 'Course document exceeds the 2 MB limit');
});
schema.methods.markSectionContentModified = function (this: mongoose.Document) { this.markModified('draft.page.sections'); };

export type CourseDocument = InferSchemaType<typeof schema> & { markSectionContentModified(): void };
export const Course = mongoose.models.Course as mongoose.Model<CourseDocument> | undefined ?? mongoose.model<CourseDocument>('Course', schema);
