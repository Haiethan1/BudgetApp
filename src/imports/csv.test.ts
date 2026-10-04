import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { importLimits, mappingSchema, normalizeCsv, parseCsv } from "./csv";
import { transactionInput } from "../ledger/input";

const bytes = (text: string) => new TextEncoder().encode(text);
const defaults = { accountId: "account", categoryId: "category", bucketId: "bucket" };
const mapping = mappingSchema.parse({ version: 1, profile: "Test export", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } });
function rows(text: string, input: unknown = mapping, currency = "USD") { return normalizeCsv(parseCsv(bytes(text)), mappingSchema.parse(input), currency, defaults); }

describe("CSV parsing and explicit normalization", () => {
  it("reads BOM, CRLF, quoted commas, escaped quotes, and quoted newlines", () => {
    expect(parseCsv(bytes('\uFEFFDate,Payee,Amount\r\n2026-10-04,"Shop, ""West""\nbranch",-12.34\r\n'))).toEqual({ headers: ["Date", "Payee", "Amount"], records: [["2026-10-04", 'Shop, "West"\nbranch', "-12.34"]] });
  });
  it("rejects malformed quoting, headers, binary/invalid encoding, and empty files", () => {
    for (const text of ['A,B\n"unfinished,x', 'A,B\n"closed"x,y', 'A,B\na"b,c', "A,A\nx,y", "A,\nx,y", "", "A,B\n", "A\nx\0"]) expect(() => parseCsv(bytes(text))).toThrow();
    expect(() => parseCsv(new Uint8Array([0xff]))).toThrow("UTF-8");
  });
  it("enforces actual byte, row, column, and field limits", () => {
    expect(() => parseCsv(new Uint8Array(importLimits.fileBytes + 1))).toThrow("2 MiB");
    expect(() => parseCsv(bytes(`A\n${"x\n".repeat(5001)}`))).toThrow("5,000");
    expect(parseCsv(bytes(`A\n${"x\n".repeat(5000)}`)).records).toHaveLength(5000);
    expect(() => parseCsv(bytes(Array.from({ length: 101 }, (_, i) => `C${i}`).join(",")))).toThrow("100 columns");
    expect(() => parseCsv(bytes(`A\n${"x".repeat(10001)}`))).toThrow("10,000");
  });
  it("keeps repeated purchases distinct and supplies one exact default split", () => {
    const result = rows("Date,Payee,Amount\n2026-10-04,Shop,-10.00\n2026-10-04,Shop,-10.00\n2026-10-05,Refund,+2.00");
    expect(result.map((row) => row.sourceRow)).toEqual([2, 3, 4]);
    expect(result[0]).toMatchObject({ status: "valid", source: { amount: -1000, sourceId: null }, proposed: { kind: "expense", amount: "-10.00", splits: [{ categoryId: "category", bucketId: "bucket", amount: "-10.00" }] } });
    expect(result[2]).toMatchObject({ status: "valid", source: { amount: 200 }, proposed: { kind: "refund" }, needsKindReview: true });
  });
  it("reports every row error without discarding other rows", () => {
    const result = rows("Date,Payee,Amount\n2026-02-30,,0\n2026-10-04,Good,-1.00\n2026-10-05,Too short");
    expect(result[0]).toMatchObject({ status: "invalid", sourceRow: 2 });
    expect(result[0]?.status === "invalid" && result[0].errors).toHaveLength(3);
    expect(result[1]).toMatchObject({ status: "valid", source: { amount: -100 } });
    expect(result[2]).toMatchObject({ status: "invalid", sourceRow: 4 });
  });
  it("requires explicit date order, decimal separator, and outflow sign", () => {
    const text = 'Date,Payee,Amount\n04/05/2026,Shop,"12,34"';
    expect(rows(text)[0]).toMatchObject({ status: "invalid" });
    expect(rows(text, { ...mapping, dateFormat: "DD/MM/YYYY", decimalSeparator: ",", money: { ...mapping.money, outflowSign: "positive" } })[0]).toMatchObject({ source: { date: "2026-05-04", amount: -1234 } });
    expect(rows(text, { ...mapping, dateFormat: "MM/DD/YYYY", decimalSeparator: "," })[0]).toMatchObject({ source: { date: "2026-04-05", amount: 1234 } });
  });
  it("never rounds, accepts grouping, or accepts zero or unsafe amounts", () => {
    for (const value of ["1.001", "0", "90071992547409.92", "$1.00", "1e2", "1 000", "-0.00"]) expect(rows(`Date,Payee,Amount\n2026-10-04,Shop,${value}`)[0]).toMatchObject({ status: "invalid" });
    expect(rows("Date,Payee,Amount\n2026-10-04,Shop,-90071992547409.91")[0]).toMatchObject({ source: { amount: -9007199254740991 } });
    expect(rows("Date,Payee,Amount\n2026-10-04,Shop,-1.01", mapping, "JPY")[0]).toMatchObject({ status: "invalid" });
    expect(rows("Date,Payee,Amount\n2026-10-04,Shop,-1.001", mapping, "KWD")[0]).toMatchObject({ source: { amount: -1001 } });
  });
  it("produces ledger-valid exact amounts when an outflow sign is added to a long magnitude", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const magnitude = `${"0".repeat(39)}1`;
    const cases = [
      { text: `Date,Payee,Amount\n2026-10-04,Shop,${magnitude}`, config: { ...mapping, money: { mode: "signed", amount: "Amount", outflowSign: "positive" } } },
      { text: `Date,Payee,Debit,Credit\n2026-10-04,Shop,${magnitude},`, config: { ...mapping, money: { mode: "debit-credit", debit: "Debit", credit: "Credit", unused: "blank" } } },
    ];
    for (const { text, config } of cases) {
      const row = normalizeCsv(parseCsv(bytes(text)), mappingSchema.parse(config), "USD", { accountId: id, categoryId: id, bucketId: id })[0];
      if (row?.status !== "valid") throw new Error("Expected a valid one-dollar purchase.");
      expect(row.source.amount).toBe(-100);
      expect(transactionInput.parse(row.proposed)).toMatchObject({ amount: "-1.00", splits: [{ amount: "-1.00" }] });
    }
  });
  it("validates debit/credit policies and ignores bank category and card columns", () => {
    const input = { ...mapping, date: "Transaction Date", payee: "Description", money: { mode: "debit-credit", debit: "Debit", credit: "Credit", unused: "blank" } };
    const result = rows(fs.readFileSync("docs/fixtures/capital-one-candidate.csv", "utf8"), input);
    expect(result.map((row) => row.status === "valid" ? row.source.amount : null)).toEqual([-10000, 2000, 10000]);
    expect(result[2]).toMatchObject({ needsKindReview: true, proposed: { kind: "refund", splits: [{ categoryId: "category", bucketId: "bucket", amount: "100.00" }] } });
    const simple = { ...mapping, money: { mode: "debit-credit", debit: "Debit", credit: "Credit", unused: "blank" } };
    for (const amount of [",", "1,1", "-1,", "1,0"]) expect(rows(`Date,Payee,Debit,Credit\n2026-10-04,Shop,${amount}`, simple)[0]).toMatchObject({ status: "invalid" });
    expect(rows("Date,Payee,Debit,Credit\n2026-10-04,Shop,1,0", { ...simple, money: { ...simple.money, unused: "blank-or-zero" } })[0]).toMatchObject({ source: { amount: -100 } });
  });
  it("rejects unknown, reused, and missing mapping columns and requires mapped source IDs", () => {
    for (const change of [{ payee: "Missing" }, { payee: "Date" }]) expect(() => rows("Date,Payee,Amount\n2026-10-04,Shop,-1", { ...mapping, ...change })).toThrow("distinct existing");
    expect(rows("Date,Payee,Amount,ID\n2026-10-04,Shop,-1,", { ...mapping, sourceId: "ID" })[0]).toMatchObject({ status: "invalid" });
    expect(rows("Date,Payee,Amount,ID\n2026-10-04,Shop,-1,abc", { ...mapping, sourceId: "ID" })[0]).toMatchObject({ source: { sourceId: "abc" } });
    expect(() => mappingSchema.parse({ ...mapping, version: 2 })).toThrow();
  });
});
