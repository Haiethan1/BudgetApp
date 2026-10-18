import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetGuidance, SheetSetup } from "./sheet-setup";
import { setupProgress } from "../sheets/setup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const facts = { accounts: 1, categories: 0, groups: 0, budgets: 0, formats: 0, cycleDay: 1, completed: false };
it("keeps optional settings separate from first-entry completion", () => {
  expect(setupProgress(facts)).toEqual({ ready: true, optionalConfigured: 0, hasOpportunities: true });
  expect(setupProgress({ ...facts, categories: 1, groups: 1, budgets: 1, formats: 1 }).hasOpportunities).toBe(true);
  expect(setupProgress({ ...facts, completed: true }).hasOpportunities).toBe(false);
});
it("offers optional customization without asking members to edit owner-only cycles", () => {
  const member = renderToStaticMarkup(<SheetSetup facts={facts} role="member" />);
  expect(member).toContain("Customize later");
  expect(member).not.toContain("Budget cycle");
  expect(member).not.toContain("Required");
  expect(renderToStaticMarkup(<SheetSetup facts={facts} role="owner" />)).toContain('href="/settings#budget-cycle"');
});
it("keeps page help available on completed sheets without flashing a fresh guide before browser preferences load", () => {
  for (const completed of [false, true]) {
    const html = renderToStaticMarkup(<SheetGuidance sheet={{ id: "sheet", role: "member", setup: { ...facts, completed }, accounts: [] }} userId="user" section="budgets" />);
    expect(html).toContain(">Help</button>");
    expect(html).not.toContain("Start setup");
    expect(html).not.toContain("Step 1");
  }
});
