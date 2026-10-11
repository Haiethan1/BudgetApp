import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/budgets",
  useSearchParams: () => new URLSearchParams("month=2026-10"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

it("puts sheet switching after the money navigation and uses simple selected-sheet URLs", () => {
  const sheet = { id: "private-sheet-id", name: "Household", currency: "USD", role: "owner" };
  const html = renderToStaticMarkup(<AppShell routed sheet={sheet} sheets={[sheet]} month="2026-09" userName="Alex" currencies={["USD"]}><p>Budget content</p></AppShell>);
  expect(html).toContain('aria-current="page" href="/budgets?month=2026-10"');
  expect(html).toContain('href="/transactions?month=2026-10&amp;add=1"');
  expect(html.indexOf("Switch sheet")).toBeGreaterThan(html.indexOf("</nav>"));
  expect(html).not.toContain("private-sheet-id");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("Create sheet");
  expect(html).toContain("Household");
  expect(html).toContain("Budget content");
  expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('<main class="page"'));
});
