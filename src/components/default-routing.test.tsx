import { expect, it, vi } from "vitest";
import Home from "../app/page";
import LegacyDefault from "../app/sheets/[sheetId]/page";
import { primarySections, sections, defaultSection, pageHref, preservedLegacyHref } from "./shell-state";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "selected" }) }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("@/auth/server", () => ({ isInitialized: () => true, getAuth: () => ({ api: { getSession: async () => ({ user: { id: "owner" } }) } }) }));
vi.mock("@/sheets/service", () => ({ accessibleSelection: () => ({ id: "selected" }), listSheets: () => [] }));
vi.mock("@/sheets/http", () => ({ selectionCookie: "selected" }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/ui", () => ({ EmptyState: () => null }));
vi.mock("@/components/shell-state", async () => await import("./shell-state"));
vi.mock("@/sheets/input", () => ({ supportedCurrencies: ["USD"] }));
vi.mock("@/components/legacy-sheet-link", () => ({ LegacySheetLink: () => null }));
it("opens the selected sheet in Expenses from home while retaining every explicit legacy route", async () => {
  await expect(Home()).rejects.toThrow("redirect:/transactions");
  expect(pageHref(defaultSection)).toBe("/transactions"); expect(primarySections).toEqual(["transactions", "owed", "settings"]);
  for (const section of ["overview", "budgets", "import", "transactions", "owed", "settings"]) expect(sections).toContain(section);
});
it("preserves historical/entry/import query parameters on a default legacy sheet link", async () => {
  const result = await LegacyDefault({ params: Promise.resolve({ sheetId: "sheet" }), searchParams: Promise.resolve({ batchId: "batch", from: "", to: "", kind: "transfer", add: "1" }) });
  expect(result.props.sheetId).toBe("sheet");
  const url = new URL(result.props.destination, "https://homebooks.test");
  expect(url.pathname).toBe("/transactions"); expect(Object.fromEntries(url.searchParams)).toEqual({ batchId: "batch", from: "", to: "", kind: "transfer", add: "1" });
  expect(preservedLegacyHref("/settings?month=2026-10", "#spending-categories")).toBe("/settings?month=2026-10#spending-categories");
  expect(preservedLegacyHref("/settings#default-budgets", "#ignored")).toBe("/settings#default-budgets");
});
