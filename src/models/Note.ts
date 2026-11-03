import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { strictOptions } from './common';

const schema = new Schema({ enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true }, authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, body: { type: String, required: true, trim: true, maxlength: 5000 } }, strictOptions);
schema.index({ enrollmentId: 1, createdAt: -1 });
export type NoteDocument = InferSchemaType<typeof schema>;
export const Note = mongoose.models.Note as mongoose.Model<NoteDocument> | undefined ?? mongoose.model<NoteDocument>('Note', schema);
