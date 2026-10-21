import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expenseDraft, expenseShares, gridBalance, gridDetails, gridTransaction, remainingUnderMe, signedDecimal } from "./expense-grid";
import { ledgerRecordSchema } from "./presentation";
import { defaultGridLayout, gridColumns, gridLayoutKey } from "./grid-layout";
import { gridFilterInput, initialGridFilters } from "./grid-filters";

const accountId = randomUUID(), categoryId = randomUUID(), otherCategory = randomUUID(), me = randomUUID(), parents = randomUUID();
const defaults = { categoryId, bucketId: me };
const record = ledgerRecordSchema.parse({ id: randomUUID(), accountId, accountName: "Card", accountArchived: false, date: "2026-10-04", payee: "Market", kind: "expense", amount: -10000, version: 2, notes: "Keep receipt", splits: [{ categoryId, categoryName: "Groceries", categoryArchived: false, bucketId: me, bucketName: "Me", bucketArchived: false, amount: -3000 }, { categoryId: otherCategory, categoryName: "Other", categoryArchived: false, bucketId: me, bucketName: "Me", bucketArchived: false, amount: -3000 }, { categoryId, categoryName: "Groceries", categoryArchived: false, bucketId: parents, bucketName: "Parents", bucketArchived: false, amount: -4000 }] });
const simple = { ...record, splits: [{ ...record.splits[0], amount: -6000 }, record.splits[2]] };
describe("expense grid row semantics", () => {
  it("aggregates repeated person shares while preserving each underlying category on metadata edits", () => {
    expect(expenseShares(record)).toEqual(new Map([[me, 6000n], [parents, 4000n]]));
    const draft = expenseDraft({ record, currency: "USD" });
    expect(draft).toMatchObject({ total: "100.00", shares: { [me]: "60.00", [parents]: "40.00" } });
    const input = gridTransaction({ ...draft, payee: "Updated", notes: "Reminder\nSecond line" }, record, "USD", categoryId);
    expect(input).toMatchObject({ kind: "expense", amount: "-100.00", notes: "Reminder\nSecond line" });
    expect(input.splits).toEqual(record.splits.map(split => ({ categoryId: split.categoryId, bucketId: split.bucketId, amount: signedDecimal(split.amount, "USD") })));
  });
  it("preserves categories and unaffected split order when changing simple shares or removing a share", () => {
    const draft = expenseDraft({ record: simple, currency: "USD" });
    const input = gridTransaction({ ...draft, shares: { [me]: "65", [parents]: "35" } }, simple, "USD", otherCategory);
    expect(input.splits).toEqual([{ categoryId, bucketId: me, amount: "-65.00" }, { categoryId, bucketId: parents, amount: "-35.00" }]);
    const removed = gridTransaction({ ...draft, shares: { [me]: "100", [parents]: "" } }, simple, "USD", otherCategory);
    expect(removed.splits).toEqual([{ categoryId, bucketId: me, amount: "-100.00" }]);
  });
  it("requires explicit category editing for changed multi-category or archived shares", () => {
    const draft = { ...expenseDraft({ record, currency: "USD" }), shares: { [me]: "50", [parents]: "50" } };
    expect(() => gridTransaction(draft, record, "USD", categoryId)).toThrow("Edit category allocation in Details");
    const detail = gridDetails(draft, record, "USD", defaults);
    expect(detail.draft.splits.map(split => [split.categoryId, split.amount])).toEqual([[categoryId, "30.00"], [otherCategory, "30.00"], [categoryId, "50.00"]]);
    expect(detail.hint).toContain("original allocations are preserved");
    const archived = { ...simple, splits: simple.splits.map(split => ({ ...split, categoryArchived: true })) };
    const unchanged = expenseDraft({ record: archived, currency: "USD" });
    expect(() => gridTransaction(unchanged, archived, "USD", categoryId)).not.toThrow();
    expect(() => gridTransaction({ ...unchanged, shares: { [me]: "50", [parents]: "50" } }, archived, "USD", categoryId)).toThrow("Details");
  });
  it("keeps raw incomplete strings and never silently rounds, balances, or saves partial rows", () => {
    const draft = { ...expenseDraft({ record: simple, currency: "USD" }), total: "1.", shares: { [me]: "0.", [parents]: "" } };
    expect(gridBalance(draft, "USD").valid).toBe(false);
    expect(() => gridTransaction(draft, simple, "USD", categoryId)).toThrow();
    expect(draft.total).toBe("1."); expect(draft.shares[me]).toBe("0.");
    for (const total of ["0", "-0", "1.001", "90071992547409.92"]) expect(gridBalance({ ...draft, total }, "USD").valid).toBe(false);
  });
  it("assigns the exact remaining amount under Me only on request and rejects overassignment", () => {
    const draft = { ...expenseDraft({ record: null, currency: "USD", accountId }), total: "100.01", shares: { [parents]: "33.34", [me]: "100.01" } };
    const balanced = remainingUnderMe(draft, "USD", me);
    expect(balanced.shares).toEqual({ [parents]: "33.34", [me]: "66.67" });
    expect(draft.shares[me]).toBe("100.01");
    expect(gridBalance(balanced, "USD").valid).toBe(true);
    expect(() => remainingUnderMe({ ...draft, shares: { [parents]: "100.02" } }, "USD", me)).toThrow("exceed");
  });
  it("shows refunds negative, stores them positive, and excludes zero or mixed-sign shares", () => {
    const refund = { ...simple, kind: "refund" as const, amount: 10000, splits: simple.splits.map(split => ({ ...split, amount: -split.amount })) };
    const draft = expenseDraft({ record: refund, currency: "USD" });
    expect(draft).toMatchObject({ total: "-100.00", shares: { [me]: "-60.00", [parents]: "-40.00" } });
    expect(gridTransaction(draft, refund, "USD", categoryId)).toMatchObject({ kind: "refund", amount: "100.00" });
    const balanced = remainingUnderMe({ ...draft, shares: { [parents]: "-33.33" } }, "USD", me);
    expect(balanced.shares[me]).toBe("-66.67");
    expect(gridBalance({ ...draft, shares: { [me]: "60", [parents]: "-160" } }, "USD").valid).toBe(false);
    expect(gridBalance({ ...draft, shares: { [me]: "-100", [parents]: "0" } }, "USD").valid).toBe(false);
  });
});
describe("expense view and viewer layout", () => {
  const people = [{ id: me, name: "Me", isProtected: true, isArchived: false }, { id: parents, name: "Parents", isProtected: false, isArchived: false }, { id: "old", name: "Archived", isProtected: false, isArchived: true }];
  it("keeps Me first by default, appends new people, and preserves explicit hide/order choices", () => {
    expect(gridColumns(people, defaultGridLayout).map(person => person.id)).toEqual([me, parents]);
    const layout = { ...defaultGridLayout, order: [parents, "old", me], hidden: [me] };
    expect(gridColumns([...people, { id: "new", name: "New", isProtected: false, isArchived: false }], layout).map(person => person.id)).toEqual([parents, "old", "new"]);
    expect(gridLayoutKey("owner", "sheet")).not.toBe(gridLayoutKey("member", "sheet"));
    expect(gridLayoutKey("owner", "sheet")).not.toBe(gridLayoutKey("owner", "other"));
  });
  it("defaults to expense/refund scope, preserves batch/all-dates links and explicit old kind filters", () => {
    const base = { from: "2026-10-08", to: "2026-11-07" };
    expect(gridFilterInput(initialGridFilters(base))).toMatchObject({ ...base, view: "expenses" });
    expect(gridFilterInput(initialGridFilters({ ...base, query: { batchId: record.id } }))).not.toHaveProperty("from");
    expect(gridFilterInput(initialGridFilters({ ...base, query: { kind: "transfer", from: "2026-01-01", accountId, bucketId: me } }))).toMatchObject({ view: "all", kind: "transfer", from: "2026-01-01", accountId, bucketId: me });
  });
});
