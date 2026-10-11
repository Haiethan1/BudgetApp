import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageSkeleton } from "./page-skeleton";

const route = vi.hoisted(() => ({ pathname: "/budgets" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

it("reserves all three budget summary cards without displaying financial values", () => {
  route.pathname = "/budgets";
  const html = renderToStaticMarkup(<PageSkeleton />);
  expect(html.match(/skeleton-value/g)).toHaveLength(3);
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain("USD");
});

it("reserves Overview's two body panels and recent transaction rows", () => {
  route.pathname = "/overview";
  const html = renderToStaticMarkup(<PageSkeleton />);
  expect(html).toContain('class="overview-grid"');
  expect(html.match(/class="skeleton-record"/g)).toHaveLength(5);
  expect(html.match(/class="shared-panel /g)).toHaveLength(6);
});
