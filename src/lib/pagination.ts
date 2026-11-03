import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginationResult<T>(items: T[], total: number, page: number, pageSize: number): Pagination<T> {
  return { items, total, page, pageSize };
}

export function paginationOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
