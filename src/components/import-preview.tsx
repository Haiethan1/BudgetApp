"use client";
import { useState } from "react";
import type { z } from "zod";
import type { inspectionSchema, parsedPreviewSchema } from "@/imports/presentation";
import { displayAmount } from "../ledger/presentation";
import { Badge, Button, Notice, Panel } from "./ui";
import { Dialog } from "./dialog";

type Preview = z.infer<typeof parsedPreviewSchema>;
type Inspection = z.infer<typeof inspectionSchema>;
const pageSize = 10;

export function ImportPreview({ inspection, preview, currency, dateColumn, payeeColumn, moneyColumns = [], sourceIdColumn = "" }: {
  inspection: Inspection; preview: Preview | null; currency: string; dateColumn: string; payeeColumn: string; moneyColumns?: string[]; sourceIdColumn?: string;
}) {
  const [page, setPage] = useState(1);
  const [invalidPage, setInvalidPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const rows = preview?.rows ?? inspection.samples.map((sample) => ({ ...sample, status: "unvalidated" as const }));
  const invalidRows = preview?.rows.filter((row) => row.status === "invalid") ?? [];
  const detail = rows.find((row) => row.sourceRow === selected);
  function sourceValue(fields: string[], column: string) { return column ? fields[inspection.headers.indexOf(column)]?.trim() || "Blank" : "Not mapped"; }
  function rowButton(row: typeof rows[number]) {
    const valid = row.status === "valid";
    const invalid = row.status === "invalid";
    const payee = valid ? row.source.payee : sourceValue(row.fields, payeeColumn);
    return <Button key={row.sourceRow} className="import-preview-row" aria-label={`Inspect source row ${row.sourceRow}: ${payee}`} onClick={() => setSelected(row.sourceRow)}>
      <span className="import-preview-position">Row {row.sourceRow}</span>
      <span className="import-preview-description"><span className="import-preview-payee">{payee === "Not mapped" ? "Source details" : payee}</span><span className="hint">{valid ? row.source.date : sourceValue(row.fields, dateColumn)}</span></span>
      <span className="import-preview-value">{valid ? <span className="amount">{displayAmount(row.source.amount, currency, true)}</span> : null}<Badge tone={invalid ? "warning" : "neutral"}>{valid ? row.proposed.kind : invalid ? "Invalid" : "Not validated"}</Badge></span>
      <span className="import-preview-chevron" aria-hidden="true">›</span>
    </Button>;
  }
  function pagination(count: number, current: number, change: (page: number) => void, label: string) {
    return <div className="ledger-pagination"><span>{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, count)} of {count} {label}</span>{count > pageSize && <div className="actions"><Button aria-label={`Previous ${label} page`} disabled={current === 1} onClick={() => change(current - 1)}>Previous</Button><Button aria-label={`Next ${label} page`} disabled={current * pageSize >= count} onClick={() => change(current + 1)}>Next</Button></div>}</div>;
  }
  return <Panel>
    <h2>Compare your file with Homebooks</h2>
    <p className="hint">The first three rows below use your current choices. Check a purchase and money received before continuing. Negative amounts mean spending; positive amounts mean money received. You can change the proposed kind in review.</p>
    <div className="import-comparison-list">{rows.slice(0, 3).map((row) => <section key={row.sourceRow} className="import-comparison-row" aria-label={`Compare source row ${row.sourceRow}`}>
      <div><h3>Your file · row {row.sourceRow}</h3><dl className="import-comparison-fields">{[...new Set([dateColumn, payeeColumn, ...moneyColumns, sourceIdColumn].filter(Boolean))].map((heading) => <div key={heading}><dt>{heading}</dt><dd>{sourceValue(row.fields, heading)}</dd></div>)}</dl>{!dateColumn && !payeeColumn && !moneyColumns.some(Boolean) && <p className="hint">Choose the headings above. Their values will appear here.</p>}</div>
      <div><h3>Transaction in Homebooks</h3>{row.status === "valid" ? <dl className="import-comparison-fields"><div><dt>Spending date</dt><dd>{row.source.date}</dd></div><div><dt>Description</dt><dd>{row.source.payee}</dd></div><div><dt>Signed amount</dt><dd className="amount">{displayAmount(row.source.amount, currency, true)}</dd></div><div><dt>Proposed kind</dt><dd>{row.proposed.kind}</dd></div></dl> : row.status === "invalid" ? <p className="field-error">{row.errors.join(" ")} Correct or exclude this row in review.</p> : <p className="hint">Fill in the required choices above to see how Homebooks reads this row. No transaction has been created.</p>}</div>
    </section>)}</div>
    <h2>{preview ? "Parsed CSV rows" : "Source samples"}</h2>
    {preview ? <p className="hint">{preview.validCount} valid · {preview.invalidCount} invalid. Open any row to inspect its source fields and parsed transaction.</p> : <p className="hint">Showing the first {inspection.samples.length} source rows. Continue to review checks your choices and shows all {inspection.rowCount} parsed rows.</p>}
    {inspection.skippedBlankCount > 0 && <p className="hint">{inspection.skippedBlankCount} fully blank {inspection.skippedBlankCount === 1 ? "row skipped" : "rows skipped"}.</p>}
    {invalidRows.length > 0 && <section className="import-invalid-section" aria-labelledby="import-invalid-heading"><h3 id="import-invalid-heading">Invalid rows ({invalidRows.length})</h3><p className="hint">These rows need attention. Correct or exclude them during review.</p><div className="import-preview-list">{invalidRows.slice((invalidPage - 1) * pageSize, invalidPage * pageSize).map((row) => <div key={row.sourceRow}>{rowButton(row)}<p className="field-error import-preview-errors">{row.errors.join(" ")}</p></div>)}</div>{pagination(invalidRows.length, invalidPage, setInvalidPage, "invalid rows")}</section>}
    {invalidRows.length > 0 && <h3>All CSV rows</h3>}
    <div className="import-preview-list">{rows.slice((page - 1) * pageSize, page * pageSize).map(rowButton)}</div>
    {pagination(rows.length, page, setPage, "rows")}
    {detail && <Dialog open title={`Source row ${detail.sourceRow}`} onClose={() => setSelected(null)}>
      <h3>Parsed transaction</h3>
      {detail.status === "valid" ? <dl className="import-detail-fields"><div><dt>Transaction date</dt><dd>{detail.source.date}</dd></div><div><dt>Description</dt><dd>{detail.source.payee}</dd></div><div><dt>Amount</dt><dd>{displayAmount(detail.source.amount, currency, true)}</dd></div><div><dt>Kind</dt><dd>{detail.proposed.kind}</dd></div></dl> : detail.status === "invalid" ? <Notice tone="error">{detail.errors.join(" ")}</Notice> : <p className="hint">Choose the required CSV import format settings. Continue to review checks the file and shows the parsed result.</p>}
      <h3>Original CSV fields</h3><dl className="import-detail-fields">{Array.from({ length: Math.max(inspection.headers.length, detail.fields.length) }, (_, index) => <div key={index}><dt>{inspection.headers[index] ?? `Extra field ${index + 1}`}</dt><dd>{detail.fields[index] || "Blank"}</dd></div>)}</dl>
    </Dialog>}
  </Panel>;
}
