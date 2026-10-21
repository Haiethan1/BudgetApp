import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { debtSummarySchema } from "../repayments/debt-input";
import { receivedDraft, repaymentDateLabel } from "../repayments/presentation";
import { RepaymentRecords } from "./repayment-records";

const debt = debtSummarySchema.parse({ id: randomUUID(), sheetId: randomUUID(), description: "Water bill", debtor: "Parents", recipient: "Me", total: 10000, legacy: false, version: 1, groupedInto: null, createdAt: 0, updatedAt: 0, paid: 2000, remaining: 8000, completionDate: null, lastReceivedDate: "2026-10-03", hasNotes: true, needsReview: false });
function render(overrides: Partial<typeof debt> = {}) { return renderToStaticMarkup(<RepaymentRecords debts={[{ ...debt, ...overrides }]} currency="USD" loading={false} selecting={false} selected={[]} onSelect={() => {}} onDetails={() => {}} onReceived={() => {}} />); }
it("shows explicit direction, partial amounts, last received date and notes access in table and phone cards", () => {
  const html = render();
  for (const text of ["Who", "For what", "Owed", "Paid back", "Still owed", "Received on", "Notes", "Parents", "to Me", "Partial", "Last received", "$80.00", "View notes for Water bill", "Received repayment for Water bill"]) expect(html).toContain(text);
  expect(html).not.toContain("Completed");
});
it("shows completion dates only for paid entries and keeps unknown recipients/review needs visible", () => {
  expect(repaymentDateLabel({ ...debt, remaining: 0, completionDate: "2026-10-04" })).toEqual({ label: "Completed", date: "2026-10-04" });
  const paid = render({ remaining: 0, paid: 10000, completionDate: "2026-10-04" });
  expect(paid).toContain("Completed"); expect(paid).not.toContain("Received repayment for");
  const unresolved = render({ recipient: null, needsReview: true, hasNotes: false });
  expect(unresolved).toContain("Needs recipient"); expect(unresolved).toContain("Review source"); expect(unresolved).toContain("Set recipient");
  expect(unresolved).not.toContain("Received repayment for"); expect(unresolved).not.toContain("View notes for");
});
it("prefills a received draft exactly without altering the agreement or treating opening the form as a payment", () => {
  const initial = structuredClone(debt);
  expect(receivedDraft(debt, "USD", "2026-10-21")).toEqual({ amount: "80.00", date: "2026-10-21", comment: "" });
  expect(debt).toEqual(initial);
  expect(receivedDraft({ remaining: 1234 }, "KWD", "2026-10-21").amount).toBe("1.234");
});
