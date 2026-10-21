import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PlanAttention } from "./plan-attention";
it("keeps matched plans needing review visible even when there are no active plans", () => {
  expect(renderToStaticMarkup(<PlanAttention attention={{ active: 0, overdue: 0, needsReview: 0 }} />)).toBe("");
  const review = renderToStaticMarkup(<PlanAttention attention={{ active: 0, overdue: 0, needsReview: 1 }} />);
  expect(review).toContain("1 need source review"); expect(review).toContain('href="/budgets#upcoming-payments"');
  const active = renderToStaticMarkup(<PlanAttention attention={{ active: 2, overdue: 1, needsReview: 0 }} />);
  expect(active).toContain("2 active · 1 overdue"); expect(active).not.toContain("need source review");
});
