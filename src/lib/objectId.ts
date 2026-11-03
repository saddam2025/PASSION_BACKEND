import mongoose from 'mongoose';
import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, {
  message: 'Invalid identifier',
});

export function toObjectId(value: string): mongoose.Types.ObjectId {
  if (!/^[a-fA-F0-9]{24}$/.test(value)) throw new TypeError('Invalid MongoDB ObjectId');
  return new mongoose.Types.ObjectId(value);
}
