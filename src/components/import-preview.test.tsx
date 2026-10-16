import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectionSchema, parsedPreviewSchema } from "../imports/presentation";
import { ImportPreview } from "./import-preview";
import { normalizeCsv, parseCsv } from "../imports/csv";
import { mappingSchema } from "../imports/input";

const inspection = inspectionSchema.parse({ headers: ["Date", "Payee", "Amount"], samples: [], rowCount: 21, skippedBlankCount: 0 });
const entityId = "00000000-0000-4000-8000-000000000001";

describe("parsed CSV preview", () => {
  it("compares actual file fields with normalized dates and reversed purchase signs", () => {
    const csv = parseCsv(new TextEncoder().encode("When,Merchant,Total\n03/04/2026,Corner shop,42.50\n04/04/2026,Returned purchase,-8.00"));
    const mapping = mappingSchema.parse({ version: 1, profile: "This import", date: "When", payee: "Merchant", dateFormat: "DD/MM/YYYY", decimalSeparator: ".", money: { mode: "signed", amount: "Total", outflowSign: "positive" } });
    const rows = normalizeCsv(csv, mapping, "USD", { accountId: entityId, categoryId: entityId, bucketId: entityId });
    const preview = parsedPreviewSchema.parse({ rows, validCount: 2, invalidCount: 0, skippedBlankCount: 0 });
    const source = inspectionSchema.parse({ headers: csv.headers, samples: rows, rowCount: 2, skippedBlankCount: 0 });
    const html = renderToStaticMarkup(<ImportPreview inspection={source} preview={preview} currency="USD" dateColumn="When" payeeColumn="Merchant" moneyColumns={["Total"]} />);
    expect(html).toContain('<dt>When</dt><dd>03/04/2026</dd>');
    expect(html).toContain('<dt>Total</dt><dd>42.50</dd>');
    expect(html).toContain('<dt>Spending date</dt><dd>2026-04-03</dd>');
    expect(html).toContain('-$42.50');
    expect(html).toContain('+$8.00');
    expect(html).toContain('<dt>Proposed kind</dt><dd>refund</dd>');
  });

  it("keeps debit/credit blanks beside the real interpretation and never fabricates unchecked results", () => {
    const csv = parseCsv(new TextEncoder().encode("Day,Detail,Purchases,Received\n2026-10-10,Train,12.00,\n2026-10-11,Refund,,3.00"));
    const mapping = mappingSchema.parse({ version: 1, profile: "This import", date: "Day", payee: "Detail", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "debit-credit", debit: "Purchases", credit: "Received", unused: "blank" } });
    const rows = normalizeCsv(csv, mapping, "USD", { accountId: entityId, categoryId: entityId, bucketId: entityId });
    const source = inspectionSchema.parse({ headers: csv.headers, samples: rows, rowCount: 2, skippedBlankCount: 0 });
    const props = { inspection: source, currency: "USD", dateColumn: "Day", payeeColumn: "Detail", moneyColumns: ["Purchases", "Received"] };
    const unchecked = renderToStaticMarkup(<ImportPreview {...props} preview={null} />);
    expect(unchecked).toContain('<dt>Received</dt><dd>Blank</dd>');
    expect(unchecked).toContain('No transaction has been created.');
    expect(unchecked).not.toContain('-$12.00');
    const preview = parsedPreviewSchema.parse({ rows, validCount: 2, invalidCount: 0, skippedBlankCount: 0 });
    const checked = renderToStaticMarkup(<ImportPreview {...props} preview={preview} />);
    expect(checked).toContain('-$12.00');
    expect(checked).toContain('+$3.00');
  });
  it("shows only the first ten parsed rows and offers the next page", () => {
    const preview = parsedPreviewSchema.parse({ validCount: 21, invalidCount: 0, skippedBlankCount: 0, rows: Array.from({ length: 21 }, (_, index) => ({
      status: "valid", sourceRow: index + 2, fields: ["2026-10-09", `Purchase ${index + 1}`, "-1.00"],
      source: { date: "2026-10-09", payee: `Purchase ${index + 1}`, amount: -100, sourceId: null },
      proposed: { accountId: entityId, date: "2026-10-09", payee: `Purchase ${index + 1}`, kind: "expense", amount: "-1.00", splits: [{ categoryId: entityId, bucketId: entityId, amount: "-1.00" }] },
    })) });
    const html = renderToStaticMarkup(<ImportPreview inspection={inspection} preview={preview} currency="USD" dateColumn="Date" payeeColumn="Payee" />);
    expect(html.match(/aria-label="Inspect source row /g)).toHaveLength(10);
    expect(html).toContain("Inspect source row 11: Purchase 10");
    expect(html).not.toContain("Purchase 11");
    expect(html).toContain("1–10 of 21 rows");
    expect(html).toContain('aria-label="Next rows page"');
  });

  it("limits the independent invalid list to ten rows while retaining all-row pagination", () => {
    const preview = parsedPreviewSchema.parse({ validCount: 0, invalidCount: 21, skippedBlankCount: 0, rows: Array.from({ length: 21 }, (_, index) => ({ status: "invalid", sourceRow: index + 2, fields: ["wrong", `Purchase ${index + 1}`, "0"], errors: ["Enter a real date."] })) });
    const html = renderToStaticMarkup(<ImportPreview inspection={inspection} preview={preview} currency="USD" dateColumn="Date" payeeColumn="Payee" />);
    expect(html.match(/aria-label="Inspect source row /g)).toHaveLength(20);
    expect(html).not.toContain("Purchase 11");
    expect(html).toContain("1–10 of 21 invalid rows");
    expect(html).toContain('aria-label="Next invalid rows page"');
    expect(html).toContain("1–10 of 21 rows");
  });
});
