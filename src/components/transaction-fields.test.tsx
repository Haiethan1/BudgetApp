import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { newDraft } from "../ledger/presentation";
import { TransactionFields } from "./transaction-fields";

const draft = { ...newDraft({ accountIds: ["cash"], categoryId: "food", bucketId: "me", date: "2026-10-18" }), payee: "Lunch", amount: "12.34" };
it("puts the editable description and amount before date, type, and account", () => {
  const html = renderToStaticMarkup(<TransactionFields id="entry" draft={draft} currency="USD" account={{ kind: "editable", accounts: [{ id: "cash", name: "Cash", isArchived: false }] }} onChange={() => undefined} />);
  const fields = ["payee", "amount", "date", "kind", "account"].map(name => html.indexOf(`id="entry-${name}"`));
  expect(fields.every(index => index > 0)).toBe(true);
  expect(fields).toEqual([...fields].sort((a, b) => a - b));
  expect(html).toContain("Description"); expect(html).toContain("Amount (USD)");
  expect(html).toContain("Money out");
});
it("shows the fixed import account and preserves raw incomplete edits", () => {
  const html = renderToStaticMarkup(<TransactionFields id="import-entry" draft={{ ...draft, payee: "", amount: "", date: "" }} currency="USD" account={{ kind: "fixed", name: "Visa" }} validateRequired onChange={() => undefined} />);
  expect(html).toContain("Visa");
  expect(html).not.toContain('<select id="import-entry-account"');
  expect(html).toContain("Enter a description.");
  expect(html).toContain("Enter a real date.");
  expect(html).toContain('id="import-entry-amount"');
});
it("makes refund/income direction and editable transfer direction explicit while retaining positive input", () => {
  for (const kind of ["refund", "income", "transfer"] as const) {
    const html = renderToStaticMarkup(<TransactionFields id="entry" draft={{ ...draft, kind, direction: "in" }} currency="USD" account={{ kind: "fixed", name: "Visa" }} onChange={() => undefined} />);
    expect(html).toContain('value="12.34"');
    if (kind === "refund") expect(html).toContain("Money received · reduces spending");
    if (kind === "income") expect(html).toContain("Money in · excluded from spending");
    if (kind === "transfer") { expect(html).toContain("Transfer direction"); expect(html).toContain('<option value="in" selected="">Money in'); }
  }
});
