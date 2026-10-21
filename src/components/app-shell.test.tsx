import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./app-shell";
import { MonthPicker } from "./month-picker";

vi.mock("next/navigation", () => ({
  usePathname: () => "/budgets",
  useSearchParams: () => new URLSearchParams("month=2026-10"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

it("puts sheet switching after the money navigation and uses simple selected-sheet URLs", () => {
  const sheet = { id: "private-sheet-id", name: "Household", currency: "USD", role: "owner" };
  const html = renderToStaticMarkup(<AppShell routed sheet={sheet} sheets={[sheet]} month="2026-09" userName="Alex" currencies={["USD"]}><p>Budget content</p></AppShell>);
  expect(html).toContain('aria-current="page" href="/budgets?month=2026-10-01"');
  expect(html).toContain('href="/transactions?month=2026-10-01&amp;add=1"');
  expect(html.indexOf("Switch sheet")).toBeGreaterThan(html.indexOf("</nav>"));
  expect(html).not.toContain("private-sheet-id");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("Create sheet");
  expect(html).toContain("Household");
  expect(html).toContain("Budget content");
  expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('<main class="page"'));
});

it("renders period navigation for supported dates below year 1000", () => {
  for (const month of ["0001-01-01", "0999-12-08"]) {
    const html = renderToStaticMarkup(<MonthPicker month={month} sheet={{ cycleStartDay: 8 }} onChange={() => {}} />);
    expect(html).toContain("Selected period");
    expect(html).toContain("Previous period");
    expect(html).toContain("Current period");
  }
});
it("keeps Import's title and sharing compact without a separate transaction-entry toolbar", () => {
  const sheet = { id: "sheet", name: "Household", currency: "USD", role: "owner" };
  const html = renderToStaticMarkup(<AppShell section="import" sheet={sheet} sheets={[sheet]} month="2026-10" userName="Alex" currencies={["USD"]}><p>CSV rows</p></AppShell>);
  expect(html).toContain('class="page daily-page"'); expect(html).toContain('class="button secondary expense-heading-share"');
  expect(html).not.toContain('class="phone-actions"'); expect(html).not.toContain("Add transaction"); expect(html).toContain("CSV rows");
});
