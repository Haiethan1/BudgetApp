import { expect, it } from "vitest";
import { defaultReviewPageSize, resizedReviewPage, reviewPageSizeSchema, reviewPageWindow } from "./review-pagination";

it("defaults to fifty review rows independently of parsed preview limits", () => {
  expect(defaultReviewPageSize).toBe(50);
  expect(reviewPageWindow({ total: 1000, page: 1, pageSize: defaultReviewPageSize })).toEqual({ page: 1, pages: 20, start: 0, end: 50, total: 1000 });
  for (const value of [25, 50, 100]) expect(reviewPageSizeSchema.parse(value)).toBe(value);
  for (const value of [10, 0, 1000]) expect(reviewPageSizeSchema.safeParse(value).success).toBe(false);
});
it("keeps the previously first visible row on the new page when increasing or decreasing size", () => {
  expect(resizedReviewPage({ page: 3, previousSize: 50, nextSize: 100 })).toBe(2);
  expect(resizedReviewPage({ page: 3, previousSize: 100, nextSize: 25 })).toBe(9);
  expect(resizedReviewPage({ page: 2, previousSize: 25, nextSize: 50 })).toBe(1);
});
it("bounds the final page after reload and never shows a reversed empty range", () => {
  expect(reviewPageWindow({ total: 101, page: 3, pageSize: 50 })).toEqual({ page: 3, pages: 3, start: 100, end: 101, total: 101 });
  expect(reviewPageWindow({ total: 101, page: 20, pageSize: 100 })).toEqual({ page: 2, pages: 2, start: 100, end: 101, total: 101 });
  expect(reviewPageWindow({ total: 0, page: 20, pageSize: 50 })).toEqual({ page: 1, pages: 1, start: 0, end: 0, total: 0 });
});
