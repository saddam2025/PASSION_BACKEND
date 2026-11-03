import { Schema } from 'mongoose';

export const timestamps = { createdAt: true, updatedAt: true } as const;
export const strictOptions = { timestamps, strict: 'throw' as const, minimize: false };
export const sha256Hash = { type: String, required: true, match: /^[a-f0-9]{64}$/i, select: false };
export const objectIdRef = (ref: string) => ({ type: Schema.Types.ObjectId, ref, required: true });
