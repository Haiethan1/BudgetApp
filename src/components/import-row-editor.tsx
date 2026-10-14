"use client";

import type { readSheet } from "@/sheets/service";
import { transactionKindSchema } from "../ledger/input";
import { allocationBalance, displayAmount, type Draft } from "../ledger/presentation";
import type { ReviewRow } from "@/imports/presentation";
import { Button, Field, Notice, Selector } from "./ui";
import { Dialog } from "./dialog";
import { ExpenseAllocationFields } from "./expense-allocation-fields";
import type { SessionRowDraft } from "../imports/session-review";
import { reviewRowSignature } from "../imports/inline-review";
type Sheet = ReturnType<typeof readSheet>;

export function SourceDetails({ row, currency }: { row: ReviewRow; currency: string }) {
  const original = row.original;
  return <><h3>Original source</h3>{original.status === "invalid" ? <dl>{Object.entries(original.selected).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || "Blank"}</dd></div>)}</dl> : <p>{original.source.date} · {original.source.payee} · {displayAmount(original.source.amount, currency, true)}{original.source.sourceId && <><br />Source ID: {original.source.sourceId}</>}</p>}
    {original.status === "invalid" && row.source && <><h3>Current corrected source</h3><p>{row.source.date} · {row.source.payee} · {displayAmount(row.source.amount, currency, true)}{row.source.sourceId && ` · Source ID ${row.source.sourceId}`}</p></>}
    {row.matching.earlierRow !== null && <Notice>This source ID also appears in row {row.matching.earlierRow} of this file.</Notice>}
    {row.matching.candidateCount > 0 && <><h3>Matching transactions</h3><p className="hint">Incoming occurrence {row.matching.occurrence} · {row.matching.existingOccurrences} existing matching occurrences.{row.matching.candidateCount > 20 && ` Showing the first 20 of ${row.matching.candidateCount} candidates.`}</p>{row.matching.candidates.map((candidate) => <details key={candidate.id} className="import-candidate"><summary>{candidate.payee} · {displayAmount(candidate.amount, currency, true)}{candidate.deleted ? " · Deleted" : ""}</summary><p>Current transaction: {candidate.date} · {candidate.kind} · {candidate.payee} · {displayAmount(candidate.amount, currency, true)}</p>{candidate.source ? <p>Original imported fields: {candidate.source.date} · {candidate.source.payee} · {displayAmount(candidate.source.amount, currency, true)}{candidate.source.sourceId && ` · Source ID ${candidate.source.sourceId}`}</p> : <p>Manually entered transaction.</p>}{candidate.deleted && <p>This deleted transaction still retains its duplicate identity.</p>}</details>)}</>}
  </>;
}
export function ImportRowEditor({ sheet, row, pending, value, error, onClose, onChange, onUseLatest, onKeepEdits }: { sheet: Sheet; row: ReviewRow; pending: boolean; value: SessionRowDraft; error?: string; onClose: () => void; onChange: (value: SessionRowDraft) => void; onUseLatest?: () => void; onKeepEdits?: () => void }) {
  const category = sheet.categories.find((c) => c.isProtected); const bucket = sheet.buckets.find((b) => b.isProtected);
  if (!category || !bucket) throw new Error("Missing sheet defaults.");
  const defaults = { categoryId: category.id, bucketId: bucket.id };
  const { transaction: draft, correction, decision } = value;
  const balance = allocationBalance(draft, sheet.currency);
  const change = (values: Partial<Draft>) => onChange({ ...value, proposalEdited: true, transaction: { ...draft, ...values } });
  if (row.matching.status === "definite" && !correction) return <Dialog open drawer title={`Inspect source row ${row.sourceRow}`} onClose={onClose} pending={pending}><Notice>This row is already imported and will be skipped. Its original identity remains unchanged after ledger edits or deletion.</Notice><SourceDetails row={row} currency={sheet.currency} /></Dialog>;
  return <Dialog open drawer title={`Review source row ${row.sourceRow}`} pending={pending} onClose={onClose}>
    {error && <Notice tone="error">{error}</Notice>}
    {value.baseline !== reviewRowSignature(row) && <Notice tone="warning"><p>This review changed. Your raw edits are preserved. Latest proposed transaction: {row.proposed?.date} · {row.proposed?.payee} · {row.proposed?.kind} · {row.proposed?.amount}. Compare the source and matching details below before choosing.</p><div className="actions import-actions"><Button disabled={pending} onClick={onUseLatest}>Use latest values</Button><Button disabled={pending} onClick={onKeepEdits}>Keep my edits against latest</Button></div></Notice>}
    <SourceDetails row={row} currency={sheet.currency} />{row.matching.status === "possible" && <Notice tone="warning">{row.matching.reason}</Notice>}
    <div><fieldset className="editor-fields" disabled={pending}>
      <Selector id="import-decision" label="Import action" value={decision} onChange={(e) => onChange({ ...value, decision: e.target.value === "keep" ? "keep" : e.target.value === "skip" ? "skip" : e.target.value === "exclude" ? "exclude" : "pending" })}><option value="pending">Choose an action</option><option value="keep">Import as a new transaction</option>{row.original.status === "valid" && <option value="skip">Do not import, count this occurrence</option>}<option value="exclude">Do not import this row</option></Selector><p className="hint">Count this occurrence includes the valid row in matching occurrence counts. Do not import this row excludes it from matching later rows. Neither choice creates a transaction.</p>
      {correction !== null ? <>{!draft.accountId && <Notice tone="error">{row.errors.join(" ")}</Notice>}<h3>Correct mapped values</h3>{Object.entries(correction).map(([name, cellValue], i) => <Field key={name} id={`correct-source-${i}`} label={`${name} (required)`} aria-required value={cellValue} error={!cellValue.trim() ? "Enter the mapped value or choose Do not import this row." : undefined} onChange={(e) => onChange({ ...value, correction: { ...correction, [name]: e.target.value }, decision: value.decision === "pending" && row.matching.status === "new" ? "keep" : value.decision, transaction: value.proposalEdited ? draft : { ...draft, accountId: "" } })} maxLength={10000} />)}<p className="hint">A valid correction is ready to import with its proposed values unless a duplicate decision is required. Valid corrections show the proposed transaction below. Further source corrections preserve transaction fields you have edited. Final Import checks duplicate status again for these corrected source values.</p></> : null}{draft.accountId && <>
        <h3>Proposed transaction</h3><Field id="import-entry-date" label="Date (required)" error={!draft.date ? "Enter a real transaction date." : undefined} required type="date" value={draft.date} onChange={(e) => change({ date: e.target.value })} /><Field id="import-entry-payee" label="Payee (required)" error={!draft.payee.trim() ? "Enter a payee." : undefined} required value={draft.payee} maxLength={200} onChange={(e) => change({ payee: e.target.value })} />
        <Notice tone="warning">Check Transaction type before importing. Card payments are Transfers. Income and transfers do not count as spending.</Notice>
        <Selector id="import-entry-kind" label="Transaction type" hint="Changes stay in this import session until final Import." value={draft.kind} onChange={(e) => change({ kind: transactionKindSchema.parse(e.target.value) })}>{["expense", "refund", "income", "transfer"].map((kind) => <option value={kind} key={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector>
        <Field id="import-entry-amount" label={`Amount (${sheet.currency})`} required error={!balance.valid ? balance.message : undefined} value={draft.amount} inputMode="decimal" hint="Enter a positive amount. The kind determines its sign." onChange={(e) => change({ amount: e.target.value })} />
        {draft.kind === "transfer" && <Selector id="import-entry-direction" label="Transfer direction" value={draft.direction} onChange={(e) => change({ direction: e.target.value === "in" ? "in" : "out" })}><option value="out">Money out</option><option value="in">Money in</option></Selector>}
        <ExpenseAllocationFields id="import-allocation" draft={draft} currency={sheet.currency} defaults={defaults} categories={sheet.categories} buckets={sheet.buckets} onChange={change} />
      </>}
    </fieldset><footer className="editor-footer"><p className="hint">Changes are kept until you leave or refresh this page. Nothing has been imported.</p>{draft.accountId && !draft.splitMode && <p className="hint" role="status">{balance.message}</p>}<Button onClick={onClose}>Close review</Button></footer></div>
  </Dialog>;
}
