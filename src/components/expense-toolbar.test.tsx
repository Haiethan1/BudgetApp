import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { readSheet } from "../sheets/service";
import { initialGridFilters } from "../ledger/grid-filters";
import { ExpenseFilters, ExpenseToolbar } from "./expense-toolbar";

const period = { from: "2026-10-01", to: "2026-10-31" };
const sheet = { id: "sheet", name: "Household", currency: "USD", role: "owner", setup: { accounts: 0, categories: 0, groups: 0, budgets: 0, formats: 0, cycleDay: 1, completed: true }, cycleStartDay: 1, cycleVersion: 1, cycleHistory: { baselineDay: 1, revisions: [] }, accounts: [], people: [], categories: [], buckets: [] } satisfies ReturnType<typeof readSheet>;
const filters = initialGridFilters(period);
it("keeps the default daily controls compact without repeating period or advanced filters", () => {
  const html = renderToStaticMarkup(<ExpenseToolbar sheet={sheet} filters={filters} period={period} onChange={() => {}} onNew={() => {}} onColumns={() => {}} onFilters={() => {}} onTrack={() => {}} />);
  for (const text of ["Account", "Search descriptions", "Add expense", "Import CSV", ">Filters<", 'aria-label="Columns"']) expect(html).toContain(text);
  for (const text of ["2026-10-01", "Active filters", "Clear filters", "All dates", 'id="expense-view"', "Filters (2)"]) expect(html).not.toContain(text);
});
it("keeps all-transactions mode and date-reset actions available in the filter dialog", () => {
  const html = renderToStaticMarkup(<ExpenseFilters sheet={sheet} filters={filters} onClose={() => {}} onApply={() => {}} onClear={() => {}} />);
  for (const text of ['id="expense-view"', "Expenses &amp; refunds", "All transactions", "From date", "Through date", "Clear filters", "All dates", "Apply filters"]) expect(html).toContain(text);
});
it("identifies custom scope without treating the selected billing period as an extra filter", () => {
  const html = renderToStaticMarkup(<ExpenseToolbar sheet={sheet} filters={{ ...filters, view: "all", kind: "transfer" }} period={period} onChange={() => {}} onNew={() => {}} onColumns={() => {}} onFilters={() => {}} onTrack={() => {}} />);
  expect(html).toContain("Filters (2)"); expect(html).toContain("All transactions · transfer"); expect(html).not.toContain("2026-10-01");
});
