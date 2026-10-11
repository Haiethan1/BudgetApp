import { z } from "zod";

export const reviewPageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]);
export type ReviewPageSize = z.infer<typeof reviewPageSizeSchema>;
export const defaultReviewPageSize: ReviewPageSize = 50;
export const reviewPageSizes: ReviewPageSize[] = [25, 50, 100];

export function reviewPageWindow({ total, page, pageSize }: { total: number; page: number; pageSize: ReviewPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  const start = (current - 1) * pageSize;
  return { page: current, pages, start, end: Math.min(start + pageSize, total), total };
}

export function resizedReviewPage({ page, previousSize, nextSize }: { page: number; previousSize: ReviewPageSize; nextSize: ReviewPageSize }) {
  return Math.floor((page - 1) * previousSize / nextSize) + 1;
}
