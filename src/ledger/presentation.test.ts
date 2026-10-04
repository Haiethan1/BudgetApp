import { describe, expect, it } from "vitest";
import { allocationBalance, decimalAmount, displayAmount, draftInput, localDate, newDraft, recordDraft, type LedgerRecord } from "./presentation";

const accountId = "00000000-0000-4000-8000-000000000001";
const categoryId = "00000000-0000-4000-8000-000000000002";
const bucketId = "00000000-0000-4000-8000-000000000003";
const defaults = { categoryId, bucketId };
const draft = () => ({ ...newDraft({ accountIds: [accountId], ...defaults, date: "2026-10-04" }), payee: "Market", amount: "100.00" });

describe("manual ledger presentation", () => {
  it("uses browser calendar fields instead of converting the date to UTC", () => {
    expect(localDate(new Date(2026, 9, 4, 23, 59))).toBe("2026-10-04");
    expect(localDate(new Date(2026, 9, 5, 0, 1))).toBe("2026-10-05");
  });
  it("preselects only a sole active account and retains protected defaults", () => {
    expect(draft()).toMatchObject({ kind: "expense", accountId, date: "2026-10-04", splits: [{ categoryId, bucketId }] });
    expect(newDraft({ accountIds: [], ...defaults }).accountId).toBe("");
    expect(newDraft({ accountIds: [accountId, categoryId], ...defaults }).accountId).toBe("");
  });
  it("shows signed ledger money exactly at the supported integer boundary", () => {
    expect(displayAmount(-Number.MAX_SAFE_INTEGER, "USD", true)).toBe("-$90,071,992,547,409.91");
    expect(displayAmount(Number.MAX_SAFE_INTEGER, "USD", true)).toBe("+$90,071,992,547,409.91");
    expect(displayAmount(-1, "USD", true)).toBe("-$0.01");
    expect(displayAmount(20, "USD", true)).toBe("+$0.20");
  });
  it("formats currency precision including zero and three decimal places", () => {
    expect(decimalAmount(125, "JPY")).toBe("125");
    expect(displayAmount(-125, "JPY", true)).toBe("-¥125");
    expect(decimalAmount(125, "KWD")).toBe("0.125");
    expect(displayAmount(125, "KWD", true)).toBe("+KWD\u00a00.125");
  });
  it("converts positive form magnitudes into every kind and transfer direction", () => {
    expect(draftInput(draft(), "USD", defaults).amount).toBe("-100.00");
    expect(draftInput({ ...draft(), kind: "refund" }, "USD", defaults).amount).toBe("100.00");
    expect(draftInput({ ...draft(), kind: "income" }, "USD", defaults)).toMatchObject({ amount: "100.00", splits: [{ ...defaults, amount: "100.00" }] });
    expect(draftInput({ ...draft(), kind: "transfer", direction: "out" }, "USD", defaults).amount).toBe("-100.00");
    expect(draftInput({ ...draft(), kind: "transfer", direction: "in" }, "USD", defaults).amount).toBe("100.00");
  });
  it("requires exact split equality and reports the remaining penny", () => {
    const split = { ...draft(), splitMode: true, splits: [{ key: "one", ...defaults, amount: "60.00" }, { key: "two", ...defaults, amount: "39.99" }] };
    expect(allocationBalance(split, "USD")).toEqual({ valid: false, message: "Allocated 99.99 USD · Remaining 0.01 USD" });
    expect(() => draftInput(split, "USD", defaults)).toThrow("Allocations must add up exactly");
    const balanced = { ...split, splits: [{ key: "one", ...defaults, amount: "60.00" }, { key: "two", ...defaults, amount: "40.00" }] };
    expect(draftInput(balanced, "USD", defaults).splits.map((item) => item.amount)).toEqual(["-60.00", "-40.00"]);
  });
  it("keeps oversplit totals exact even when their sum exceeds the integer storage range", () => {
    const split = { ...draft(), amount: "90071992547409.91", splitMode: true, splits: [{ key: "one", ...defaults, amount: "90071992547409.91" }, { key: "two", ...defaults, amount: "90071992547409.90" }] };
    expect(allocationBalance(split, "USD")).toEqual({ valid: false, message: "Allocated 180143985094819.81 USD · Over by 90071992547409.90 USD" });
  });
  it("rejects zero, negative, overprecision, and unsupported amount magnitudes", () => {
    for (const amount of ["0", "-1", "1.001", "90071992547409.92"]) {
      expect(allocationBalance({ ...draft(), amount }, "USD").valid).toBe(false);
      expect(() => draftInput({ ...draft(), amount }, "USD", defaults)).toThrow();
    }
  });
  it("retains historical split references and exact positive amounts when editing", () => {
    const record: LedgerRecord = { id: "00000000-0000-4000-8000-000000000004", accountId, accountName: "Old account", accountArchived: true, date: "2026-09-30", payee: "Old market", kind: "expense", amount: -12345, version: 2, splits: [{ categoryId, categoryName: "Old category", categoryArchived: true, bucketId, bucketName: "Old bucket", bucketArchived: true, amount: -12345 }] };
    const editing = recordDraft(record, "USD");
    expect(editing).toMatchObject({ accountId, date: "2026-09-30", amount: "123.45", splits: [{ categoryId, bucketId, amount: "123.45" }] });
    expect(draftInput(editing, "USD", defaults)).toMatchObject({ amount: "-123.45", splits: [{ categoryId, bucketId, amount: "-123.45" }] });
  });
});
