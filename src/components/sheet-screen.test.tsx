import { expect, it, vi } from "vitest";
import type { readSheet } from "../sheets/service";
import { listTransactions } from "../ledger/service";
import { SheetScreen } from "./sheet-screen";
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected redirect"); } }));
vi.mock("@/auth/server", () => ({ getAuth: () => ({ api: { getSession: async () => ({ user: { id: "owner" } }) } }) }));
vi.mock("@/sheets/service", () => ({ readSheet: vi.fn(), SheetError: class extends Error {} }));
vi.mock("./sheet-unavailable", () => ({ SheetUnavailable: () => null }));
vi.mock("./settings-screen", () => ({ SettingsScreen: () => null }));
vi.mock("./ledger-screen", () => ({ LedgerScreen: () => null }));
vi.mock("./import-screen", () => ({ ImportScreen: () => null }));
vi.mock("./budgets-screen", () => ({ BudgetsScreen: () => null }));
vi.mock("./owed-screen", () => ({ OwedScreen: () => null }));
vi.mock("./overview-screen", () => ({ OverviewScreen: () => null }));
vi.mock("../ledger/service", () => ({ listTransactions: vi.fn(() => ({ transactions: [], total: 0, hasTransactions: false, page: 1, pageSize: 50 })) }));
const sheet = { id: "sheet", name: "Household", currency: "USD", role: "owner", cycleStartDay: 1, cycleVersion: 1, accounts: [], people: [], categories: [], buckets: [] } satisfies ReturnType<typeof readSheet>;
it("preserves ledger component identity and its editor when refreshed cycle configuration changes", async () => {
  const initial = await SheetScreen({ sheetId: sheet.id, section: "transactions", month: "2026-10", add: true, resolvedSheet: sheet });
  const refreshed = await SheetScreen({ sheetId: sheet.id, section: "transactions", month: "2026-10", add: true, resolvedSheet: { ...sheet, cycleStartDay: 8, cycleVersion: 2 } });
  expect(refreshed.props.children.type).toBe(initial.props.children.type);
  expect(refreshed.props.children.key).toBe(initial.props.children.key);
  expect(refreshed.props.children.props.sheet.cycleStartDay).toBe(8);
  const nextMonth = await SheetScreen({ sheetId: sheet.id, section: "transactions", month: "2026-11", resolvedSheet: sheet });
  expect(nextMonth.props.children.key).toBe(initial.props.children.key);
  expect(nextMonth.props.children.props.month).toBe("2026-11");
});

it("provides the authorized ledger and complete inclusive cycle before the page is displayed", async () => {
  const result = await SheetScreen({ sheetId: sheet.id, section: "transactions", month: "2026-10", resolvedSheet: { ...sheet, cycleStartDay: 8 } });
  expect(listTransactions).toHaveBeenLastCalledWith("owner", "sheet", expect.objectContaining({ from: "2026-10-08", to: "2026-11-07" }));
  expect(result.props.children.props.initialResult).toEqual({ transactions: [], total: 0, hasTransactions: false, page: 1, pageSize: 50 });
});
