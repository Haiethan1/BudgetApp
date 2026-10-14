import { describe, expect, it } from "vitest";
import { divideExpense, divisionSummary } from "./expense-division";
import { draftInput, newDraft } from "./presentation";

const defaults = { categoryId: "00000000-0000-4000-8000-000000000002", bucketId: "00000000-0000-4000-8000-000000000003" };
const initial = () => ({ ...newDraft({ accountIds: ["00000000-0000-4000-8000-000000000001"], ...defaults, date: "2026-10-04" }), payee: "Market", amount: "100.00" });
const divided = (amounts: string[]) => ({ ...initial(), splitMode: true, splits: amounts.map((amount, index) => ({ ...defaults, key: String(index), amount })) });

describe("expense division", () => {
  it("opens two blank parts, preserves first labels, and never guesses fixture allocations", () => {
    const selected = { ...initial(), splits: [{ ...defaults, categoryId: "selected-category", bucketId: "selected-group", amount: "100.00", key: "first" }] };
    expect(divideExpense(selected, defaults, "second")).toEqual({ splitMode: true, splits: [{ ...selected.splits[0], amount: "" }, { ...defaults, amount: "", key: "second" }] });
    expect(divisionSummary({ ...selected, ...divideExpense(selected, defaults, "second") }, "USD")).toMatchObject({ total: "100.00 USD", remaining: "Still to assign 100.00 USD", errors: ["Enter an amount for this part.", "Enter an amount for this part."] });
  });
  it("preserves all existing allocations, including a third part", () => {
    const draft = divided(["10", "20", "70"]);
    expect(divideExpense(draft, defaults, "unused")).toEqual({ splitMode: true, splits: draft.splits });
    expect(divisionSummary(draft, "USD")).toMatchObject({ remaining: "Still to assign 0.00 USD", error: "" });
  });
  it("shows exact remaining and over-assigned values while retaining invalid draft strings", () => {
    expect(divisionSummary(divided(["60", "39.99"]), "USD")).toMatchObject({ remaining: "Still to assign 0.01 USD", error: "The parts do not yet match the original total. Assign the remaining amount before saving." });
    expect(divisionSummary(divided(["60", "40.01"]), "USD")).toMatchObject({ remaining: "Over assigned by 0.01 USD", error: "The parts exceed the original total. Reduce a part or remove it." });
    const incomplete = divided(["60", "40."]);
    expect(divisionSummary(incomplete, "USD")).toMatchObject({ remaining: "Still to assign 40.00 USD" });
    expect(incomplete.splits[1]?.amount).toBe("40.");
  });
  it("identifies missing, wrong-sign, zero, precision, and overflow errors beside parts", () => {
    const summary = divisionSummary(divided(["", "-1", "0", "0.001", "90071992547409.92"]), "USD");
    expect(summary.errors).toEqual(["Enter an amount for this part.", "Enter a positive amount. The transaction kind determines its sign.", "Enter an amount greater than zero.", "Enter a valid positive amount with the precision supported by USD.", "Enter a valid positive amount with the precision supported by USD."]);
    expect(summary.remaining).toBe("Still to assign 100.00 USD");
  });
  it("adds and removes amounts without rounding, even above the safe integer sum", () => {
    const huge = { ...divided(["90071992547409.91", "90071992547409.90"]), amount: "90071992547409.91" };
    expect(divisionSummary(huge, "USD").remaining).toBe("Over assigned by 90071992547409.90 USD");
    const draft = divided(["60", "40"]);
    expect(divisionSummary({ ...draft, splits: draft.splits.slice(0, 1) }, "USD").remaining).toBe("Still to assign 40.00 USD");
  });
  it("supports smallest units, zero- and three-decimal currencies, and valid refunds", () => {
    expect(divisionSummary({ ...divided(["0.01", "0.01"]), amount: "0.02" }, "USD").error).toBe("");
    expect(divisionSummary({ ...divided(["1", "1"]), amount: "2" }, "JPY").remaining).toBe("Still to assign 0 JPY");
    expect(divisionSummary({ ...divided(["0.001", "0.002"]), amount: "0.003" }, "KWD").error).toBe("");
    const refund = { ...divided(["60", "40"]), kind: "refund" as const };
    expect(draftInput(refund, "USD", defaults).splits.map((part) => part.amount)).toEqual(["60", "40"]);
    expect(draftInput(divided(["60", "40"]), "USD", defaults).splits.map((part) => part.amount)).toEqual(["-60", "-40"]);
  });
});
