"use client";
import { useState } from "react";
import type { readSheet } from "@/sheets/service";
import { parseMoney, transactionKindSchema } from "../ledger/input";
import { allocationBalance, decimalAmount, displayAmount, draftInput, type Draft } from "../ledger/presentation";
import type { Review, ReviewRow } from "@/imports/presentation";
import { Button, Field, Notice, Selector } from "./ui";
import { Dialog } from "./dialog";
import { ExpenseAllocationFields } from "./expense-allocation-fields";
type Sheet = ReturnType<typeof readSheet>;

export function SourceDetails({ row, currency }: { row: ReviewRow; currency: string }) {
  const original = row.original;
  return <><h3>Original source</h3>{original.status === "invalid" ? <dl>{Object.entries(original.selected).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || "Blank"}</dd></div>)}</dl> : <p>{original.source.date} · {original.source.payee} · {displayAmount(original.source.amount, currency, true)}{original.source.sourceId && <><br />Source ID: {original.source.sourceId}</>}</p>}
    {row.matching.earlierRow !== null && <Notice>This source ID also appears in row {row.matching.earlierRow} of this file.</Notice>}
    {row.matching.candidateCount > 0 && <><h3>Matching transactions</h3><p className="hint">Incoming occurrence {row.matching.occurrence} · {row.matching.existingOccurrences} existing matching occurrences.{row.matching.candidateCount > 20 && ` Showing the first 20 of ${row.matching.candidateCount} candidates.`}</p>{row.matching.candidates.map((candidate) => <details key={candidate.id} className="import-candidate"><summary>{candidate.payee} · {displayAmount(candidate.amount, currency, true)}{candidate.deleted ? " · Deleted" : ""}</summary><p>Current transaction: {candidate.date} · {candidate.kind} · {candidate.payee} · {displayAmount(candidate.amount, currency, true)}</p>{candidate.source ? <p>Original imported fields: {candidate.source.date} · {candidate.source.payee} · {displayAmount(candidate.source.amount, currency, true)}{candidate.source.sourceId && ` · Source ID ${candidate.source.sourceId}`}</p> : <p>Manually entered transaction.</p>}{candidate.deleted && <p>This deleted transaction still retains its duplicate identity.</p>}</details>)}</>}
  </>;
}
export function ImportRowEditor({ sheet, row, pending, onClose, onSave, onReload }: { sheet: Sheet; row: ReviewRow; pending: boolean; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>; onReload: () => Promise<Review | undefined> }) {
  const category = sheet.categories.find((c) => c.isProtected); const bucket = sheet.buckets.find((b) => b.isProtected);
  if (!category || !bucket) throw new Error("Missing sheet defaults.");
  const defaults = { categoryId: category.id, bucketId: bucket.id };
  const [draft, setDraft] = useState<Draft>(() => {
    const input = row.proposed;
    return input ? { kind: input.kind, date: input.date, accountId: input.accountId, payee: input.payee, amount: decimalAmount(parseMoney(input.amount, sheet.currency), sheet.currency), direction: parseMoney(input.amount, sheet.currency) < 0 ? "out" : "in", splitMode: input.splits.length > 1,
      splits: input.splits.map((s, i) => ({ ...s, key: String(i), amount: decimalAmount(parseMoney(s.amount, sheet.currency), sheet.currency) })) } : { kind: "expense", date: "", accountId: "", payee: "", amount: "", direction: "out", splits: [], splitMode: false };
  });
  const [correction, setCorrection] = useState(row.original.status === "invalid" ? row.original.selected : {});
  const [decision, setDecision] = useState(row.decision);
  const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  const [initial] = useState(() => JSON.stringify({ draft, correction, decision }));
  const dirty = initial !== JSON.stringify({ draft, correction, decision });
  const balance = allocationBalance(draft, sheet.currency);
  const change = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (pending || conflict) return; setError("");
    try {
      if (decision === "exclude" || decision === "skip") await onSave({ rowId: row.id, decision });
      else if (!row.source) await onSave({ rowId: row.id, correction, decision: "keep", kindReviewed: false });
      else {
        if (decision !== "keep") throw new Error("Choose keep or skip before saving this row.");
        await onSave({ rowId: row.id, decision, kindReviewed: true, proposed: draftInput(draft, sheet.currency, defaults) });
      }
    } catch (e) { const message = e instanceof Error ? e.message : "Could not save this row. Your entries are preserved."; setError(message); if (message.includes("Someone changed") || message.includes("Reload")) setConflict(true); }
  }
  async function reload() {
    const latest = await onReload(); if (!latest) { setError("Could not load the latest review. Your entries are preserved."); return; }
    const latestRow = latest.rows.find((r) => r.id === row.id); if (!latestRow) { setError("This row is unavailable."); return; }
    setDecision(latestRow.decision); setConflict(false); setError("Latest review loaded. Your proposed transaction fields are preserved. Review the decision before saving.");
  }
  if (row.matching.status === "definite") return <Dialog open drawer title={`Inspect source row ${row.sourceRow}`} onClose={onClose} pending={pending}><Notice>This row is already imported and will be skipped. Its original identity remains unchanged after ledger edits or deletion.</Notice><SourceDetails row={row} currency={sheet.currency} /></Dialog>;
  return <Dialog open drawer title={`Review source row ${row.sourceRow}`} dirty={dirty} pending={pending} onClose={onClose}>
    {error && <Notice tone="error">{error}</Notice>}{conflict && <Button onClick={() => void reload()} disabled={pending}>Reload review and preserve entries</Button>}
    <SourceDetails row={row} currency={sheet.currency} />{row.matching.status === "possible" && <Notice tone="warning">{row.matching.reason}</Notice>}
    <form onSubmit={save} noValidate><fieldset className="editor-fields" disabled={pending || conflict}>
      <Selector id="import-decision" label="Row decision" value={decision} onChange={(e) => setDecision(e.target.value === "keep" ? "keep" : e.target.value === "skip" ? "skip" : e.target.value === "exclude" ? "exclude" : "pending")}><option value="pending">Choose keep or skip</option><option value="keep">Keep as new</option>{row.source && <option value="skip">Skip this row</option>}<option value="exclude">Exclude this row</option></Selector>
      {!row.source ? <><Notice tone="error">{row.errors.join(" ")}</Notice><h3>Correct mapped values</h3>{Object.entries(correction).map(([name, value], i) => <Field key={name} id={`correct-source-${i}`} label={name} value={value} onChange={(e) => setCorrection((current) => ({ ...current, [name]: e.target.value }))} maxLength={10000} />)}<p className="hint">A valid correction is ready to import with its proposed values unless a duplicate decision is required. You can edit its kind and allocation afterward.</p></> : <>
        <h3>Proposed transaction</h3><Field id="import-entry-date" label="Date" required type="date" value={draft.date} onChange={(e) => change({ date: e.target.value })} /><Field id="import-entry-payee" label="Payee" required value={draft.payee} maxLength={200} onChange={(e) => change({ payee: e.target.value })} />
        <Notice tone="warning">Check Kind before saving. Card payments are Transfers. Income and transfers do not count as spending.</Notice>
        <Selector id="import-entry-kind" label="Kind" hint="Individual review is optional. Save row review applies any changes you make." value={draft.kind} onChange={(e) => change({ kind: transactionKindSchema.parse(e.target.value) })}>{["expense", "refund", "income", "transfer"].map((kind) => <option value={kind} key={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector>
        <Field id="import-entry-amount" label={`Amount (${sheet.currency})`} required value={draft.amount} inputMode="decimal" hint="Enter a positive amount. The kind determines its sign." onChange={(e) => change({ amount: e.target.value })} />
        {draft.kind === "transfer" && <Selector id="import-entry-direction" label="Transfer direction" value={draft.direction} onChange={(e) => change({ direction: e.target.value === "in" ? "in" : "out" })}><option value="out">Money out</option><option value="in">Money in</option></Selector>}
        <ExpenseAllocationFields id="import-allocation" draft={draft} currency={sheet.currency} defaults={defaults} categories={sheet.categories} buckets={sheet.buckets} onChange={change} />
      </>}
    </fieldset><footer className="editor-footer">{row.source && !draft.splitMode && <p className="hint" role="status">{balance.message}</p>}<Button type="submit" variant="primary" pending={pending} disabled={conflict || (decision === "keep" && Boolean(row.source) && !balance.valid)}>{!row.source && decision !== "exclude" && decision !== "skip" ? "Correct row" : "Save row review"}</Button></footer></form>
  </Dialog>;
}
