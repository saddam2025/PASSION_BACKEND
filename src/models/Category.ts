import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({ name: { ar: { type: String, required: true, trim: true, maxlength: 120 }, en: { type: String, trim: true, maxlength: 120 } }, slug: { type: String, required: true, lowercase: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }, order: { type: Number, required: true, min: 0 }, deletedAt: { type: Date, default: null } }, strictOptions);
schema.index({ order: 1 });
schema.index({ deletedAt: 1 });
export type CategoryDocument = InferSchemaType<typeof schema>;
export const Category = mongoose.models.Category as mongoose.Model<CategoryDocument> | undefined ?? mongoose.model<CategoryDocument>('Category', schema);
