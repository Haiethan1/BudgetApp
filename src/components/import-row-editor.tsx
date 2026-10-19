"use client";

import type { readSheet } from "@/sheets/service";
import { allocationBalance, displayAmount, type Draft } from "../ledger/presentation";
import type { ReviewRow } from "@/imports/presentation";
import { ImportDecision } from "./import-decision";
import { TransactionFields } from "./transaction-fields";
import { Button, Field, Notice, Help } from "./ui";
import { Dialog } from "./dialog";
import { ExpenseAllocationFields } from "./expense-allocation-fields";
import type { SessionRowDraft } from "../imports/session-review";
import { reviewRowSignature } from "../imports/inline-review";
type Sheet = ReturnType<typeof readSheet>;

export function SourceDetails({ row, currency, expanded = false }: { row: ReviewRow; currency: string; expanded?: boolean }) {
  const original = row.original;
  return <details className="transaction-source" open={expanded}><summary>CSV source and matches</summary><h3>Original CSV values</h3>{original.status === "invalid" ? <dl>{Object.entries(original.selected).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || "Blank"}</dd></div>)}</dl> : <p>{original.source.date} · {original.source.payee} · {displayAmount(original.source.amount, currency, true)}{original.source.sourceId && <><br />Source ID: {original.source.sourceId}</>}</p>}
    {original.status === "invalid" && row.source && <><h3>Current corrected source</h3><p>{row.source.date} · {row.source.payee} · {displayAmount(row.source.amount, currency, true)}{row.source.sourceId && ` · Source ID ${row.source.sourceId}`}</p></>}
    {row.matching.earlierRow !== null && <Notice>This source ID also appears in row {row.matching.earlierRow} of this file.</Notice>}
    {row.matching.candidateCount > 0 && <><h3>Matching transactions</h3><p className="hint">Incoming occurrence {row.matching.occurrence} · {row.matching.existingOccurrences} existing matching occurrences.{row.matching.candidateCount > 20 && ` Showing the first 20 of ${row.matching.candidateCount} candidates.`}</p>{row.matching.candidates.map((candidate) => <details key={candidate.id} className="import-candidate"><summary>{candidate.payee} · {displayAmount(candidate.amount, currency, true)}{candidate.deleted ? " · Deleted" : ""}</summary><p>Current transaction: {candidate.date} · {candidate.kind} · {candidate.payee} · {displayAmount(candidate.amount, currency, true)}</p>{candidate.source ? <p>Original imported fields: {candidate.source.date} · {candidate.source.payee} · {displayAmount(candidate.source.amount, currency, true)}{candidate.source.sourceId && ` · Source ID ${candidate.source.sourceId}`}</p> : <p>Manually entered transaction.</p>}{candidate.deleted && <p>This deleted transaction still retains its duplicate identity.</p>}</details>)}</>}
  </details>;
}
export function ImportRowEditor({ sheet, row, pending, value, error, onClose, onChange, onUseLatest, onKeepEdits }: { sheet: Sheet; row: ReviewRow; pending: boolean; value: SessionRowDraft; error?: string; onClose: () => void; onChange: (value: SessionRowDraft) => void; onUseLatest?: () => void; onKeepEdits?: () => void }) {
  const category = sheet.categories.find((c) => c.isProtected); const bucket = sheet.buckets.find((b) => b.isProtected);
  if (!category || !bucket) throw new Error("Missing sheet defaults.");
  const defaults = { categoryId: category.id, bucketId: bucket.id };
  const { transaction: draft, correction, decision } = value;
  const balance = allocationBalance(draft, sheet.currency);
  const change = (values: Partial<Draft>) => onChange({ ...value, proposalEdited: true, transaction: { ...draft, ...values } });
  if (row.matching.status === "definite" && !correction) return <Dialog open drawer title={`Inspect source row ${row.sourceRow}`} onClose={onClose} pending={pending}><Notice>This row is already imported and will be skipped. Its original identity remains unchanged after ledger edits or deletion.</Notice><SourceDetails row={row} currency={sheet.currency} expanded /></Dialog>;
  return <Dialog open drawer title={`Transaction details · row ${row.sourceRow}`} pending={pending} onClose={onClose}>
    {error && <Notice tone="error">{error}</Notice>}
    {value.baseline !== reviewRowSignature(row) && <Notice tone="warning"><p>This review changed. Your raw edits are preserved. Latest proposed transaction: {row.proposed?.date} · {row.proposed?.payee} · {row.proposed?.kind} · {row.proposed?.amount}. Compare the source and matching details below before choosing.</p><div className="actions import-actions"><Button disabled={pending} onClick={onUseLatest}>Use latest values</Button><Button disabled={pending} onClick={onKeepEdits}>Keep my edits against latest</Button></div></Notice>}
    {row.matching.status === "possible" && <Notice tone="warning">{row.matching.reason}</Notice>}
    <div><fieldset className="editor-fields" disabled={pending}>
      <ImportDecision id="import-decision" value={decision} allowMatchingCount={row.original.status === "valid"} labelHelp={<Help label="Import choices"><p>Import creates a transaction. Skip omits the row from matching counts. Skip, keep matching count also omits it but keeps its occurrence for later rows.</p><p>When two identical purchases match an existing transaction, choose separately for both. Use Skip, keep matching count for the one you are leaving out and Import for the other.</p></Help>} required={row.matching.status === "possible"} autoFocus={decision === "pending"} onChange={decision => onChange({ ...value, decision })} />
      {correction !== null ? <>{!draft.accountId && <Notice tone="error">{row.errors.join(" ")}</Notice>}<h3>Correct mapped values</h3>{Object.entries(correction).map(([name, cellValue], i) => <Field key={name} id={`correct-source-${i}`} label={`${name} (required)`} aria-required value={cellValue} error={!cellValue.trim() ? "Enter the mapped value or choose Skip." : undefined} onChange={(e) => onChange({ ...value, correction: { ...correction, [name]: e.target.value }, decision: value.decision === "pending" && row.matching.status === "new" ? "keep" : value.decision, transaction: value.proposalEdited ? draft : { ...draft, accountId: "" } })} maxLength={10000} />)}<p className="hint">A valid correction is ready to import unless a duplicate decision is required. Your transaction edits are preserved.</p></> : null}{draft.accountId && <>
        <TransactionFields id="import-entry" draft={draft} currency={sheet.currency} account={{ kind: "fixed", name: sheet.accounts.find(account => account.id === draft.accountId)?.name ?? "Unavailable account" }} validateRequired autoFocus={decision !== "pending"} onChange={change} />
        <ExpenseAllocationFields id="import-allocation" draft={draft} currency={sheet.currency} defaults={defaults} categories={sheet.categories} buckets={sheet.buckets} onChange={change} />
      </>}
    </fieldset><SourceDetails row={row} currency={sheet.currency} expanded={row.original.status === "invalid" || row.matching.status === "possible" || value.baseline !== reviewRowSignature(row)} /><footer className="editor-footer"><p className="hint">Changes are kept until you leave or refresh this page. Nothing has been imported.</p>{draft.accountId && !draft.splitMode && <p className="hint" role="status">{balance.message}</p>}<Button onClick={onClose}>Close details</Button></footer></div>
  </Dialog>;
}
