"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loseSheetAccess } from "./sheet-access";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { importLimits, mappingSchema, type Mapping } from "@/imports/input";
import { confirmationStatus, confirmSchema, inspectionSchema, parsedPreviewSchema, profilesSchema, reviewSchema, rowDecisionLabel, rowStatus, type Review, type ReviewRow } from "@/imports/presentation";
import { displayAmount } from "@/ledger/presentation";
import { parseMoney } from "@/ledger/input";
import { Badge, Button, EmptyState, Field, LoadingState, Notice, Panel, ResponsiveRecords, Selector } from "./ui";
import { ImportRowEditor, SourceDetails } from "./import-row-editor";
type Sheet = ReturnType<typeof readSheet>;
type Workflow = { kind: "file" } | { kind: "mapping"; inspection: z.infer<typeof inspectionSchema> } | { kind: "review"; review: Review } | { kind: "result"; review: Review };
const blankMapping = { profile: "", date: "", payee: "", sourceId: "", dateFormat: "", decimalSeparator: "", mode: "", amount: "", outflowSign: "", debit: "", credit: "", unused: "" };
type MappingDraft = typeof blankMapping;
function mappingDraft(mapping: Mapping): MappingDraft { return { ...blankMapping, ...mapping, sourceId: mapping.sourceId ?? "", ...mapping.money }; }
function parseMapping(draft: MappingDraft) { return mappingSchema.parse({ version: 1, profile: draft.profile, date: draft.date, payee: draft.payee, ...(draft.sourceId ? { sourceId: draft.sourceId } : {}), dateFormat: draft.dateFormat, decimalSeparator: draft.decimalSeparator,
  money: draft.mode === "debit-credit" ? { mode: draft.mode, debit: draft.debit, credit: draft.credit, unused: draft.unused } : { mode: draft.mode, amount: draft.amount, outflowSign: draft.outflowSign } }); }
export function ImportScreen({ sheet, batchId }: { sheet: Sheet; batchId?: string }) {
  const router = useRouter(); const base = `/api/sheets/${sheet.id}/imports`;
  const [workflow, setWorkflow] = useState<Workflow>({ kind: "file" });
  const [file, setFile] = useState<File | null>(null); const [accountId, setAccountId] = useState("");
  const [draft, setDraft] = useState<MappingDraft>(blankMapping); const [profiles, setProfiles] = useState<z.infer<typeof profilesSchema>>([]); const [profileId, setProfileId] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof parsedPreviewSchema> | null>(null); const [validated, setValidated] = useState("");
  const [pending, setPending] = useState(false); const [resuming, setResuming] = useState(Boolean(batchId));
  const [pendingMessage, setPendingMessage] = useState("Saving your choices");
  const [resumeSequence, setResumeSequence] = useState(0);
  const [message, setMessage] = useState(""); const [success, setSuccess] = useState(""); const [unavailable, setUnavailable] = useState(false);
  const [profileConflict, setProfileConflict] = useState(false); const [missing, setMissing] = useState(false);
  const [outcome, setOutcome] = useState<"idle" | "checking" | "unknown">("idle");
  const [selectedRow, setSelectedRow] = useState<string | null>(null); const [changed, setChanged] = useState<string[]>([]); const [page, setPage] = useState(1);
  const inFlight = useRef(false); const fileControl = useRef<HTMLInputElement | null>(null);
  const applyReview = useCallback((review: Review) => { setWorkflow({ kind: review.state === "committed" ? "result" : "review", review }); }, []);
  const permissionLoss = useCallback((status: number) => {
    setUnavailable(true); setWorkflow({ kind: "file" }); setFile(null); setPreview(null); setDraft(blankMapping); setProfiles([]); setSelectedRow(null); setMessage(""); setSuccess("");
    loseSheetAccess(sheet.id, status);
  }, [sheet.id]);
  const checkResponse = useCallback(async (response: Response) => {
    if (response.status === 401) { permissionLoss(401); throw new Error("Your session expired. Sign in again."); }
    if (response.status === 404) {
      const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
      if (access.status === 401 || access.status === 404) { permissionLoss(access.status); throw new Error("This sheet is unavailable."); }
      if (!access.ok) throw new Error("Could not verify access. Your entries are preserved. Try again.");
      setMissing(true); throw new Error("This import is no longer available. Choose another file. Your current entries are preserved.");
    }
    if (!response.ok) { const reply = z.object({ message: z.string() }).safeParse(await response.json()); throw new Error(reply.success ? reply.data.message : "Could not complete this action. Your entries are preserved."); }
  }, [permissionLoss, sheet.id]);
  useEffect(() => {
    if (!batchId) return; let alive = true;
    async function resume() { setResuming(true); try { const response = await fetch(`${base}/${batchId}`, { cache: "no-store" }); await checkResponse(response); const review = reviewSchema.parse(await response.json()); if (alive) { applyReview(review); setMissing(false); } } catch (e) { if (alive) setMessage(e instanceof Error ? e.message : "Could not resume this import. Try again."); } finally { if (alive) setResuming(false); } }
    void resume(); return () => { alive = false; };
  }, [batchId, base, applyReview, checkResponse, resumeSequence]);
  useEffect(() => {
    if (!accountId) return; let alive = true;
    async function loadProfiles() { try { const response = await fetch(`${base}/profiles?accountId=${accountId}`, { cache: "no-store" }); await checkResponse(response); const data = profilesSchema.parse(await response.json()); if (alive) setProfiles(data); } catch (e) { if (alive) setMessage(e instanceof Error ? e.message : "Could not load saved mappings."); } }
    void loadProfiles(); return () => { alive = false; };
  }, [accountId, base, checkResponse]);
  useEffect(() => {
    function unload(e: BeforeUnloadEvent) { if (pending || selectedRow || outcome !== "idle") { e.preventDefault(); e.returnValue = ""; } }
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [pending, selectedRow, outcome]);
  async function action(operation: () => Promise<void>, label = "Saving your choices") {
    if (inFlight.current) return; inFlight.current = true; setPendingMessage(label); setPending(true); setMessage(""); setSuccess("");
    try { await operation(); } catch (e) { setMessage(e instanceof z.ZodError ? "Choose every required column, date format, decimal format, and amount convention." : e instanceof Error ? e.message : "Could not connect. Your entries are preserved. Try again."); }
    finally { setPending(false); inFlight.current = false; }
  }
  function chooseFile(next: File | null) { setPreview(null); setValidated(""); setMessage(""); setMissing(false); setFile(next); if (next && next.size > importLimits.fileBytes) setMessage("Choose a CSV no larger than 2 MiB."); }
  async function upload(mapped: boolean, persist = false) {
    if (!file || !accountId) throw new Error("Choose a file and an active financial account.");
    if (file.size > importLimits.fileBytes) throw new Error("Choose a CSV no larger than 2 MiB.");
    const body = new FormData(); body.set("file", file); body.set("accountId", accountId);
    if (mapped) body.set("mapping", JSON.stringify(parseMapping(draft))); if (persist && profileId) body.set("profileId", profileId);
    const response = await fetch(persist ? base : `${base}/preview`, { method: "POST", body }); await checkResponse(response); return response.json();
  }
  async function saveProfile() {
    await action(async () => {
      const profile = profiles.find((p) => p.id === profileId);
      const response = await fetch(`${base}/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, mapping: parseMapping(draft), ...(profile ? { id: profile.id, version: profile.version } : {}) }) });
      if (response.status === 409) setProfileConflict(true);
      await checkResponse(response); const saved = profilesSchema.element.parse(await response.json()); setProfiles((current) => [...current.filter((p) => p.id !== saved.id), saved]); setProfileId(saved.id); setProfileConflict(false); setSuccess("Source mapping saved.");
    });
  }
  async function reloadProfiles() {
    await action(async () => { const response = await fetch(`${base}/profiles?accountId=${accountId}`, { cache: "no-store" }); await checkResponse(response); const latest = profilesSchema.parse(await response.json()); setProfiles(latest); const profile = latest.find((p) => p.id === profileId); if (!profile) throw new Error("This source profile is unavailable. Keep your mapping or choose another profile."); setDraft(mappingDraft(profile.mapping)); setPreview(null); setValidated(""); setProfileConflict(false); setSuccess("Latest saved mapping loaded."); });
  }
  async function reloadReview(): Promise<Review | undefined> {
    if (workflow.kind !== "review" && workflow.kind !== "result") return;
    try { const response = await fetch(`${base}/${workflow.review.id}`, { cache: "no-store" }); await checkResponse(response); const latest = reviewSchema.parse(await response.json()); applyReview(latest); setMissing(false); return latest; }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not reload this review. Your entries are preserved."); }
  }
  async function saveRow(input: Record<string, unknown>) {
    if (workflow.kind !== "review" || inFlight.current) return; inFlight.current = true; setPendingMessage("Saving row review"); setPending(true); setMessage("");
    try {
      const response = await fetch(`${base}/${workflow.review.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: workflow.review.version, ...input }) });
      await checkResponse(response); const review = reviewSchema.parse(await response.json()); applyReview(review); setSelectedRow(null); setSuccess("Row review saved. Resolve any remaining kind or duplicate decisions.");
    } finally { setPending(false); inFlight.current = false; }
  }
  async function verifyStatus(id: string) {
    setOutcome("checking");
    try {
      const response = await fetch(`${base}/${id}`, { cache: "no-store" }); await checkResponse(response);
      const status = confirmationStatus(await response.json());
      if (status.kind === "unknown") throw new Error("Could not determine whether this import completed.");
      if (status.review.id !== id || status.review.sheetId !== sheet.id) throw new Error("Could not verify this import's status.");
      applyReview(status.review); setOutcome("idle"); setMessage(""); setSuccess(status.kind === "committed" ? "The import completed. Its saved result is shown below." : "Status verified. No transactions were committed by this batch. Review your entries before retrying.");
    } catch (e) { setOutcome("unknown"); setMessage(`${e instanceof Error ? e.message : "Could not connect."} Check status before attempting another import.`); }
  }
  async function confirm() {
    if (workflow.kind !== "review" || outcome !== "idle") return; const review = workflow.review;
    await action(async () => {
      try {
        const response = await fetch(`${base}/${review.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: review.version }) });
        if (response.status === 409) {
          const raw: unknown = await response.json(); const stale = confirmSchema.safeParse(raw);
          if (stale.success && stale.data.kind === "stale") {
            applyReview(stale.data.review); setChanged(stale.data.changedRowIds);
            const changedRows = stale.data.review.rows.filter((r) => stale.data.changedRowIds.includes(r.id));
            const firstIndex = stale.data.review.rows.findIndex((r) => stale.data.changedRowIds.includes(r.id)); if (firstIndex >= 0) setPage(Math.floor(firstIndex / 50) + 1);
            setMessage(`Data changed since this preview. Changed source rows: ${changedRows.slice(0, 20).map((r) => r.sourceRow).join(", ")}${changedRows.length > 20 ? ` and ${changedRows.length - 20} more` : ""}. Review the highlighted rows and any decisions that need another choice.`); return;
          }
          const conflict = z.object({ message: z.string() }).safeParse(raw); setMessage(conflict.success ? conflict.data.message : "Someone changed this review. Reload latest before importing."); return;
        }
        if (response.status >= 500) { await verifyStatus(review.id); return; }
        if (!response.ok) { try { await checkResponse(response); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not import. Your review is preserved."); } return; }
        await checkResponse(response); const result = confirmSchema.parse(await response.json()); applyReview(result.review); setChanged([]);
      } catch { await verifyStatus(review.id); }
    }, "Importing transactions");
  }
  function reset() { setWorkflow({ kind: "file" }); setFile(null); setPreview(null); setValidated(""); setDraft(blankMapping); setProfileId(""); setSelectedRow(null); setPage(1); setChanged([]); setMissing(false); setMessage(""); setSuccess(""); router.replace(`/sheets/${sheet.id}/import`); }
  const stage = workflow.kind === "file" ? 1 : workflow.kind === "mapping" ? 2 : workflow.kind === "review" ? 3 : 4;
  const review = workflow.kind === "review" || workflow.kind === "result" ? workflow.review : null;
  const row = review?.rows.find((r) => r.id === selectedRow);
  const activeAccounts = sheet.accounts.filter((a) => !a.isArchived);
  function updateDraft(key: keyof MappingDraft, value: string) { setDraft((current) => ({ ...current, [key]: value })); setPreview(null); setValidated(""); }
  function column(label: string, key: "date" | "payee" | "sourceId" | "amount" | "debit" | "credit", optional = false) {
    if (workflow.kind !== "mapping") return null;
    return <Selector id={`mapping-${key}`} label={label} value={draft[key]} onChange={(e) => updateDraft(key, e.target.value)}><option value="">{optional ? "No source ID column" : "Choose column"}</option>{draft[key] && !workflow.inspection.headers.includes(draft[key]) && <option value={draft[key]}>{draft[key]} (missing from this file)</option>}{workflow.inspection.headers.map((name) => <option key={name} value={name}>{name}</option>)}</Selector>;
  }
  function allocation(row: ReviewRow) { return row.proposed?.splits.map((s) => `${sheet.categories.find((c) => c.id === s.categoryId)?.name ?? "Unavailable category"} · ${sheet.buckets.find((b) => b.id === s.bucketId)?.name ?? "Unavailable attribution"}`).join("; ") ?? "Correct or exclude"; }
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  return <div className="import-screen"><ol className="import-steps" aria-label="Import progress">{["File and account", "Mapping", "Review", "Result"].map((label, i) => <li key={label} className={stage === i + 1 ? "current" : ""} aria-current={stage === i + 1 ? "step" : undefined}>{i + 1}. {label}</li>)}</ol>
    {message && <Notice tone="error">{message}</Notice>}{batchId && workflow.kind === "file" && !resuming && message && !missing && <Button onClick={() => setResumeSequence((s) => s + 1)}>Retry loading import</Button>}{success && <Notice>{success}</Notice>}{pending && <Notice>{outcome === "checking" ? "Checking import status" : pendingMessage}</Notice>}
    {resuming ? <LoadingState /> : workflow.kind === "file" ? !activeAccounts.length ? <EmptyState title="Add a financial account first" action={<Link className="button primary" href={`/sheets/${sheet.id}/settings`}>Open Settings</Link>}>CSV transactions need an active account. Add one in Settings, then return to Import.</EmptyState> : <Panel><h2>Choose a file and account</h2><Selector id="import-account" label="Financial account" value={accountId} disabled={pending} onChange={(e) => { if (e.target.value === accountId) return; setAccountId(e.target.value); setProfiles([]); setProfileId(""); setDraft(blankMapping); setPreview(null); setValidated(""); }}><option value="">Choose account</option>{activeAccounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</Selector>
      <div className="import-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!pending) chooseFile(e.dataTransfer.files[0] ?? null); }}><p>Drop a CSV here, or choose a file.</p><input ref={fileControl} id="import-file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} aria-describedby="import-limits" aria-label="Choose CSV file" /><Button disabled={pending} onClick={() => fileControl.current?.click()}>Choose CSV file</Button></div>
      <p id="import-limits" className="hint">UTF-8 CSV · Maximum 2 MiB and 5,000 data rows.</p>{file && <p>{file.name} · {file.size.toLocaleString()} bytes · {sheet.accounts.find((a) => a.id === accountId)?.name ?? "Choose account"}</p>}<Button variant="primary" pending={pending} disabled={!file || !accountId || file.size > importLimits.fileBytes} onClick={() => void action(async () => { setWorkflow({ kind: "mapping", inspection: inspectionSchema.parse(await upload(false)) }); })}>Continue to mapping</Button>{missing && <Button onClick={reset}>Choose another file</Button>}</Panel>
      : workflow.kind === "mapping" ? <><Panel><h2>Map source columns</h2><p>{file?.name} · {workflow.inspection.rowCount.toLocaleString()} rows · {sheet.accounts.find((a) => a.id === accountId)?.name}</p><fieldset className="editor-fields" disabled={pending}>
        <Selector id="import-profile" label="Saved source profile" value={profileId} onChange={(e) => { setProfileId(e.target.value); setProfileConflict(false); const profile = profiles.find((p) => p.id === e.target.value); setDraft(profile ? mappingDraft(profile.mapping) : blankMapping); setPreview(null); setValidated(""); }}><option value="">Create an explicit mapping</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · version {p.version}</option>)}</Selector><Field id="mapping-profile-name" label="Source profile name" value={draft.profile} maxLength={80} onChange={(e) => updateDraft("profile", e.target.value)} hint="Mapping is saved for this account. Choose the date that should determine spending month." />
        <div className="import-mapping-grid">{column("Spending date column", "date")}{column("Payee / description column", "payee")}{column("Stable source ID column (optional)", "sourceId", true)}<Selector id="mapping-date-format" label="Date format" value={draft.dateFormat} onChange={(e) => updateDraft("dateFormat", e.target.value)}><option value="">Choose date format</option>{["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].map((f) => <option key={f}>{f}</option>)}</Selector><Selector id="mapping-decimal" label="Decimal separator" value={draft.decimalSeparator} onChange={(e) => updateDraft("decimalSeparator", e.target.value)}><option value="">Choose decimal format</option><option value=".">Period (12.34)</option><option value=",">Comma (12,34)</option></Selector><Selector id="mapping-money-mode" label="Amount columns" value={draft.mode} onChange={(e) => updateDraft("mode", e.target.value)}><option value="">Choose amount convention</option><option value="signed">One signed amount column</option><option value="debit-credit">Separate debit and credit columns</option></Selector>{draft.mode === "signed" ? <>{column("Amount column", "amount")}<Selector id="mapping-outflow" label="Outflow sign" value={draft.outflowSign} onChange={(e) => updateDraft("outflowSign", e.target.value)}><option value="">Choose outflow sign</option><option value="negative">Purchases are negative</option><option value="positive">Purchases are positive</option></Selector></> : draft.mode === "debit-credit" ? <>{column("Debit column", "debit")}{column("Credit column", "credit")}<Selector id="mapping-unused" label="Unused debit / credit cell" value={draft.unused} onChange={(e) => updateDraft("unused", e.target.value)}><option value="">Choose unused-cell policy</option><option value="blank">Must be blank</option><option value="blank-or-zero">Blank or zero</option></Selector></> : null}</div></fieldset>
        {profileConflict && <Notice tone="warning">The saved profile changed. Your mapping choices are preserved. Reload saved mapping to replace them explicitly.</Notice>}<div className="actions import-actions"><Button disabled={pending} onClick={() => void saveProfile()}>Save mapping</Button>{profileConflict && <Button disabled={pending} onClick={() => void reloadProfiles()}>Reload saved mapping</Button>}<Button pending={pending} onClick={() => void action(async () => { setPreview(parsedPreviewSchema.parse(await upload(true))); setValidated(JSON.stringify(draft)); })}>Validate mapping</Button></div></Panel>
        <Panel><h2>Source and parsed samples</h2><div className="import-samples">{workflow.inspection.samples.map((sample, i) => <article key={i}><h3>Source row {i + 2}</h3><dl>{workflow.inspection.headers.map((name, j) => <div key={name}><dt>{name}</dt><dd>{sample[j] || "Blank"}</dd></div>)}</dl><h4>Parsed transaction</h4>{preview?.rows[i]?.status === "valid" ? <p>{preview.rows[i].source.date} · {preview.rows[i].source.payee} · {displayAmount(preview.rows[i].source.amount, sheet.currency, true)} · {preview.rows[i].proposed.kind}</p> : preview?.rows[i]?.status === "invalid" ? <Notice tone="error">{preview.rows[i].errors.join(" ")}</Notice> : <p className="hint">Choose the mapping and validate to see the parsed result.</p>}</article>)}</div>{preview && <p>{preview.validCount} valid · {preview.invalidCount} invalid. Invalid rows can be corrected or excluded during review.</p>}</Panel><div className="actions import-actions"><Button disabled={pending} onClick={() => setWorkflow({ kind: "file" })}>Back to file and account</Button><Button variant="primary" pending={pending} disabled={!preview || validated !== JSON.stringify(draft) || profileConflict} onClick={() => void action(async () => { const review = reviewSchema.parse(await upload(true, true)); applyReview(review); router.replace(`/sheets/${sheet.id}/import?batchId=${review.id}`); })}>Continue to review</Button></div></>
      : review && workflow.kind === "result" && review.result ? <Panel><h2>{review.result.repeatedFile ? "This file was already imported" : "Import complete"}</h2><p>{review.result.added} added · {review.result.skipped} skipped · {review.result.excluded} excluded</p><div className="actions import-actions"><Link className="button primary" href={`/sheets/${sheet.id}/transactions?batchId=${review.result.viewBatchId}`}>View imported transactions</Link><Button onClick={reset}>Import another file</Button></div></Panel>
      : review && <><p>{sheet.accounts.find((a) => a.id === review.accountId)?.name} · {review.mapping.profile}</p><div className="import-counts">{[{ label: "New", count: review.counts.new }, { label: "Already imported", count: review.counts.definite }, { label: "Needs review", count: review.counts.possible }, { label: "Invalid / excluded", count: `${review.counts.invalid} / ${review.counts.excluded}` }].map(({ label, count }) => <Panel key={label}><p>{label}</p><strong>{count}</strong></Panel>)}</div>
        {review.repeatedFile ? <Notice>This file was already imported. No transactions will be added.</Notice> : <Notice>Review every kind, possible duplicate, and invalid row before confirming. Matching date, payee, and amount alone does not prove a duplicate.</Notice>}
        <Panel><ResponsiveRecords headers={["Source row", "Payee and date", "Allocation", "Status / decision", "Amount"]} rows={review.rows.slice((page - 1) * 50, page * 50).map((r) => [r.sourceRow, <div key="payee"><strong>{r.proposed?.payee ?? "Invalid source row"}</strong><p className="hint">{r.proposed?.date} · {r.proposed?.kind}</p></div>, allocation(r), <div key="status">{changed.includes(r.id) && <p className="field-error">Changed since preview</p>}<Badge tone={r.matching.status === "possible" || !r.source ? "warning" : "neutral"}>{rowStatus(r, review.repeatedFile)}</Badge><p className="hint">{rowDecisionLabel(r, review.repeatedFile)}</p><Button disabled={pending || outcome !== "idle" || missing || review.repeatedFile} onClick={() => setSelectedRow(r.id)}>{r.source ? "Review row" : "Correct or exclude"} {r.sourceRow}</Button></div>, <span className="amount" key="amount">{r.proposed ? displayAmount(parseMoney(r.proposed.amount, sheet.currency), sheet.currency, true) : "Check amount"}</span>])} cards={review.rows.slice((page - 1) * 50, page * 50).map((r) => <details key={r.id} className={changed.includes(r.id) ? "import-row-changed" : ""}><summary><strong>{r.proposed?.payee ?? "Invalid source row"}</strong><span>{r.proposed ? displayAmount(parseMoney(r.proposed.amount, sheet.currency), sheet.currency, true) : "Check amount"}</span><small>Row {r.sourceRow} · {rowStatus(r, review.repeatedFile)}{changed.includes(r.id) ? " · Changed since preview" : ""}</small></summary><p>{r.proposed?.date} · {r.proposed?.kind}</p><p>{allocation(r)}</p><p>{rowDecisionLabel(r, review.repeatedFile)}</p><SourceDetails row={r} currency={sheet.currency} />{r.errors.length > 0 && <Notice tone="error">{r.errors.join(" ")}</Notice>}<Button disabled={pending || outcome !== "idle" || missing || review.repeatedFile} onClick={() => setSelectedRow(r.id)}>{r.source ? "Review row" : "Correct or exclude"} {r.sourceRow}</Button></details>)} />
          <div className="ledger-pagination"><span>{(page - 1) * 50 + 1}–{Math.min(page * 50, review.rows.length)} of {review.rows.length} source rows</span><div className="actions"><Button disabled={page === 1 || pending} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button disabled={page * 50 >= review.rows.length || pending} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div></Panel>
        <footer className="import-footer"><p>{outcome !== "idle" ? "The outcome is uncertain. Verify batch status before retrying." : review.ready && review.counts.added === 0 ? "Nothing new to import" : `${review.counts.added} to add · ${review.counts.skipped} skipped · ${review.counts.excluded} excluded`}</p><div className="actions import-actions">{outcome !== "idle" ? <Button pending={outcome === "checking"} onClick={() => void action(() => verifyStatus(review.id))}>Check import status</Button> : <><Button variant="primary" pending={pending} disabled={!review.ready || Boolean(selectedRow) || missing} onClick={() => void confirm()}>{review.ready && review.counts.added === 0 ? "Done" : `Import ${review.counts.added} ${review.counts.added === 1 ? "transaction" : "transactions"}`}</Button><Button disabled={pending} onClick={() => void action(async () => { await reloadReview(); })}>Reload latest review</Button><Button disabled={pending} onClick={reset}>Choose another file</Button></>}</div></footer>
      </>}
    {row && workflow.kind === "review" && <ImportRowEditor key={row.id} sheet={sheet} row={row} pending={pending} onClose={() => setSelectedRow(null)} onSave={saveRow} onReload={reloadReview} />}
  </div>;
}
