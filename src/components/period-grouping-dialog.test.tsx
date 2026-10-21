import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PeriodGroupingDialog } from "./period-grouping-dialog";
import type { readSheet } from "../sheets/service";

it("requires explicit people and inclusive scope before previewing, and never records a payment on open", () => {
  const sheet = { id: "sheet", name: "Household", currency: "USD", role: "owner", setup: { accounts: 0, categories: 0, groups: 0, budgets: 0, formats: 0, cycleDay: 1, completed: true }, cycleStartDay: 1, cycleVersion: 1, cycleHistory: { baselineDay: 1, revisions: [] }, accounts: [], people: [], categories: [], buckets: [] } satisfies ReturnType<typeof readSheet>;
  const html = renderToStaticMarkup(<PeriodGroupingDialog sheet={sheet} initial={{ from: "2026-10-08", to: "2026-11-07", accountId: "" }} onClose={() => {}} onSaved={() => {}} onLost={() => {}} />);
  for (const text of ["Who owes?", "Recipient", "Through (included)", "2026-10-08", "2026-11-07", "All accounts", "Preview period", "Search, category and import filters do not limit this period."]) expect(html).toContain(text);
  expect(html).toMatch(/disabled="">Preview period/);
  for (const text of ["Received on", "Record payment", "Track selected amount"]) expect(html).not.toContain(text);
});
