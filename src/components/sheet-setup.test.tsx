import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetSetup } from "./sheet-setup";
import { setupProgress } from "../sheets/setup";

const manual = { accounts: 1, categories: 0, groups: 0, budgets: 0, formats: 0, cycleDay: 1 };
it("manual entry is ready with protected fallbacks and no optional customization", () => {
  expect(setupProgress(manual)).toEqual({ ready: true, optionalConfigured: 0, hasOpportunities: true });
  const html = renderToStaticMarkup(<SheetSetup facts={manual} role="member" />);
  expect(html).toContain("Ready for transactions. Required setup is complete.");
  expect(html).toContain("Manual entry needs no CSV format.");
  expect(html).toContain("Only the owner can edit the schedule.");
  for (const href of ["/settings#transaction-accounts", "/settings#spending-categories", "/settings#spending-groups", "/settings#default-budgets", "/settings#budget-cycle", "/import", "/transactions?add=1"]) expect(html).toContain(`href="${href}"`);
});
it("an account is required while optional progress never determines readiness", () => {
  expect(setupProgress({ ...manual, accounts: 0, categories: 3, groups: 2, budgets: 1, formats: 2 })).toEqual({ ready: false, optionalConfigured: 4, hasOpportunities: true });
  const html = renderToStaticMarkup(<SheetSetup facts={{ ...manual, accounts: 0 }} role="owner" />);
  expect(html).toContain("Needs attention");
  expect(html).toContain('href="/transactions?add=1"');
  expect(html).toContain('href="/import"');
  expect(setupProgress({ ...manual, categories: 1, groups: 1, budgets: 1, formats: 1 })).toEqual({ ready: true, optionalConfigured: 4, hasOpportunities: false });
});
