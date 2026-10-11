import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectionSchema, parsedPreviewSchema } from "../imports/presentation";
import { ImportPreview } from "./import-preview";

const inspection = inspectionSchema.parse({ headers: ["Date", "Payee", "Amount"], samples: [], rowCount: 21, skippedBlankCount: 0 });
const entityId = "00000000-0000-4000-8000-000000000001";

describe("parsed CSV preview", () => {
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
