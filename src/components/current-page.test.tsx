import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../app/(current)/[section]/page";

const selection = vi.hoisted(() => ({ id: "first", name: "First household" }));
vi.mock("@/sheets/current", () => ({ currentSheet: async () => ({
  session: { user: { id: "actor", name: "Alex", isInstanceAdmin: false } },
  sheet: { ...selection, currency: "USD", role: "owner" },
}) }));
vi.mock("@/sheets/service", () => ({ listSheets: () => [{ ...selection, currency: "USD", role: "owner" }] }));
vi.mock("@/sheets/input", () => ({ supportedCurrencies: ["USD"] }));
vi.mock("@/components/shell-state", () => import("./shell-state"));
vi.mock("@/components/app-shell", () => import("./app-shell"));
vi.mock("@/components/sheet-screen", () => ({ SheetScreen: ({ sheetId }: { sheetId: string }) => <p>Transactions for {sheetId}</p> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("Not found"); },
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams("month=2026-10"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

it("refreshes shell identity and transaction scope together when another tab changes the remembered sheet", async () => {
  const params = Promise.resolve({ section: "transactions" });
  const initial = renderToStaticMarkup(await Page({ params, searchParams: Promise.resolve({ month: "2026-10" }) }));
  expect(initial).toContain("<strong>First household</strong>");
  expect(initial).toContain("Transactions for first");
  selection.id = "second"; selection.name = "Second household";
  const changed = await Page({ params, searchParams: Promise.resolve({ month: "2026-11" }) });
  expect(changed.key).toBe("second");
  const next = renderToStaticMarkup(changed);
  expect(next).toContain("<strong>Second household</strong>");
  expect(next).toContain("Transactions for second");
  expect(next).not.toContain("First household");
  expect(next).not.toContain("Transactions for first");
});
