import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, BudgetBar, Field, Notice, ResponsiveRecords, LoadingState, Selector, Help } from "./ui";
import { closeDecision } from "./dialog";
import { consumedEntryHref, monthLabel, monthOptions, selectedMonth, pageHref } from "./shell-state";

describe("shared component contracts", () => {
  it("consumes a one-time new-entry link without changing its period, filters, or hash", () => {
    expect(consumedEntryHref("https://homebooks.test/transactions?month=2026-09-08&categoryId=food&add=1&accountId=cash&batchId=batch#ledger")).toBe("/transactions?month=2026-09-08&categoryId=food&batchId=batch#ledger");
    expect(consumedEntryHref("https://homebooks.test/transactions?add=1&accountId=cash")).toBe("/transactions");
    expect(consumedEntryHref("https://homebooks.test/transactions?month=2026-09-08&accountId=cash")).toBeNull();
  });
  it("keeps contextual help collapsed with a named non-submitting info button beside its text", () => {
    const html = renderToStaticMarkup(<Help label="Responsible for" text="Responsible for"><p>Choose whose spending this is.</p></Help>);
    expect(html).toContain('<span class="help-label">Responsible for<span');
    expect(html).toContain('type="button" class="help-trigger" aria-label="Help: Responsible for" aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("title=");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Choose whose spending this is.");
  });
  it("keeps field labels and help in one inline parent without nesting the help button inside a label", () => {
    const html = renderToStaticMarkup(<Selector id="type" label="Type" labelHelp={<Help label="Transaction type"><p>Expense or refund.</p></Help>}><option>Expense</option></Selector>);
    expect(html).toContain('<div class="help-label"><label for="type">Type</label><span class="context-help">');
    expect(html).not.toMatch(/<label[^>]*>[^<]*<button/);
    expect(html).toContain('aria-label="Help: Transaction type"');
  });
  it("keeps editor actions from submitting their surrounding form", () => {
    const html = renderToStaticMarkup(<form><Button>Split transaction</Button><Button>Remove split</Button><Button type="submit">Save transaction</Button></form>);
    expect(html).toContain('<button type="button" class="button secondary ">Split transaction</button>');
    expect(html).toContain('<button type="button" class="button secondary ">Remove split</button>');
    expect(html).toContain('<button type="submit" class="button secondary ">Save transaction</button>');
  });
  it("associates selector validation and supporting text with the choice", () => {
    const html = renderToStaticMarkup(<Selector id="entry-account" label="Account" error="Choose an account." hint="Pick its source" aria-describedby="source-help"><option value="">Choose account</option></Selector>);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="source-help entry-account-error entry-account-hint"');
    expect(html).toContain('id="entry-account-error"');
  });
  it("keeps the pending action label and prevents repeat activation", () => {
    const html = renderToStaticMarkup(<Button pending variant="primary">Create sheet</Button>);
    expect(html).toContain("disabled"); expect(html).toContain('aria-busy="true"'); expect(html).toContain("Create sheet");
  });
  it("associates field errors and hints without losing a separate description", () => {
    const html = renderToStaticMarkup(<Field id="name" label="Sheet name" error="Enter a name" hint="At most 80 characters" aria-describedby="help" />);
    expect(html).toContain('for="name"'); expect(html).toContain('aria-describedby="help name-error name-hint"'); expect(html).toContain('aria-invalid="true"');
  });
  it("caps overspending visually and keeps refund spending at zero", () => {
    expect(renderToStaticMarkup(<BudgetBar spent={120} limit={100} label="$20 overspent" />)).toContain('width:100%');
    expect(renderToStaticMarkup(<BudgetBar spent={-20} limit={100} label="-$20 net spending" />)).toContain('width:0%');
    expect(renderToStaticMarkup(<BudgetBar spent={5} limit={0} label="$5 overspent" />)).toContain('width:100%');
  });
  it("provides table headers and separate readable phone records", () => {
    const html = renderToStaticMarkup(<ResponsiveRecords headers={["Name", "Type"]} rows={[["Unassigned", "Bucket"]]} cards={[<p key="record">Unassigned · Bucket</p>]} />);
    expect(html).toContain('scope="col"'); expect(html).toContain("Unassigned · Bucket"); expect(html).toContain("record-card");
  });
  it("announces errors and real loading rather than numeric placeholders", () => {
    expect(renderToStaticMarkup(<Notice tone="error">Could not load</Notice>)).toContain('role="alert"');
    const loading = renderToStaticMarkup(<LoadingState />); expect(loading).toContain('aria-busy="true"'); expect(loading).not.toContain("$0");
  });
  it("renders structured warnings without paragraph nesting that browsers repair before hydration", () => {
    const html = renderToStaticMarkup(<Notice tone="warning"><p>Row 2 needs a duplicate decision.</p><div className="actions"><Button>Review row 2</Button></div></Notice>);
    expect(html).toBe('<div class="notice warning" role="status"><p>Row 2 needs a duplicate decision.</p><div class="actions"><button type="button" class="button secondary ">Review row 2</button></div></div>');
    expect(html).not.toMatch(/<p[^>]*>\s*<(?:p|div)\b/);
  });
  it("blocks close during commit and confirms dirty idle close", () => {
    expect(closeDecision(true, true)).toBe("blocked"); expect(closeDecision(true, false)).toBe("blocked");
    expect(closeDecision(false, true)).toBe("confirm"); expect(closeDecision(false, false)).toBe("close");
  });
  it("shares a selected month across navigation and resets it on sheet switch", () => {
    expect(pageHref("budgets", "2026-10")).toBe("/budgets?month=2026-10");
    expect(pageHref("settings", "2026-10")).toBe("/settings?month=2026-10");
    expect(pageHref("overview")).toBe("/overview");
    expect(selectedMonth("2026-13", "2026-10")).toBe("2026-10"); expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthOptions("1000-01")[0]).toBe("1000-01"); expect(monthOptions("9999-12").at(-1)).toBe("9999-12");
  });
});
