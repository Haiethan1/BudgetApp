import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, BudgetBar, Field, Notice, ResponsiveRecords, LoadingState } from "./ui";
import { closeDecision } from "./dialog";
import { monthLabel, monthOptions, selectedMonth, sheetHref } from "./shell-state";

describe("shared component contracts", () => {
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
  it("blocks close during commit and confirms dirty idle close", () => {
    expect(closeDecision(true, true)).toBe("blocked"); expect(closeDecision(true, false)).toBe("blocked");
    expect(closeDecision(false, true)).toBe("confirm"); expect(closeDecision(false, false)).toBe("close");
  });
  it("shares a selected month across navigation and resets it on sheet switch", () => {
    expect(sheetHref("sheet-a", "budgets", "2026-10")).toBe("/sheets/sheet-a/budgets?month=2026-10");
    expect(sheetHref("sheet-a", "settings", "2026-10")).toBe("/sheets/sheet-a/settings?month=2026-10");
    expect(sheetHref("sheet-b", "overview")).toBe("/sheets/sheet-b");
    expect(selectedMonth("2026-13", "2026-10")).toBe("2026-10"); expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthOptions("1000-01")[0]).toBe("1000-01"); expect(monthOptions("9999-12").at(-1)).toBe("9999-12");
  });
});
