"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loseSheetAccess } from "./sheet-access";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { importLimits, mappingSchema, type Mapping } from "@/imports/input";
import { bulkAllocationResult, confirmationStatus, confirmSchema, inspectionSchema, parsedPreviewSchema, profilesSchema, reviewSchema, type Review, type ReviewRow } from "@/imports/presentation";
import { Button, EmptyState, Field, LoadingState, Notice, Panel, Selector } from "./ui";
import { ImportRowEditor } from "./import-row-editor";
import { ImportPreview } from "./import-preview";
import { Dialog } from "./dialog";
import { appNavigationEvent } from "./navigation-guard";
import { ImportReviewRow } from "./import-review-row";
import { inlineReviewChanged, inlineReviewDraft, inlineReviewInput, reviewRowSignature, type InlineReviewDraft } from "../imports/inline-review";
import { defaultReviewPageSize, resizedReviewPage, reviewPageWindow, type ReviewPageSize } from "../imports/review-pagination";
import { ImportReviewPagination } from "./import-review-pagination";
import { ImportBulkAllocation } from "./import-bulk-allocation";
import { SourceConfiguration } from "./source-configuration";
import { emptyImportPreferences, importPreferenceKey, missingMappingColumns, preferredImportAccount, preferredImportProfile, readImportPreferences } from "../imports/preferences";
type Sheet = ReturnType<typeof readSheet>;
type Workflow = { kind: "file" } | { kind: "mapping"; inspection: z.infer<typeof inspectionSchema> } | { kind: "review"; review: Review } | { kind: "result"; review: Review };
const blankMapping = { profile: "", date: "", payee: "", sourceId: "", dateFormat: "", decimalSeparator: "", mode: "", amount: "", outflowSign: "", debit: "", credit: "", unused: "" };
type MappingDraft = typeof blankMapping;
function mappingDraft(mapping: Mapping): MappingDraft { return { ...blankMapping, ...mapping, sourceId: mapping.sourceId ?? "", ...mapping.money }; }
function parseMapping(draft: MappingDraft) { return mappingSchema.parse({ version: 1, profile: draft.profile, date: draft.date, payee: draft.payee, ...(draft.sourceId ? { sourceId: draft.sourceId } : {}), dateFormat: draft.dateFormat, decimalSeparator: draft.decimalSeparator,
  money: draft.mode === "debit-credit" ? { mode: draft.mode, debit: draft.debit, credit: draft.credit, unused: draft.unused } : { mode: draft.mode, amount: draft.amount, outflowSign: draft.outflowSign } }); }
export function ImportScreen({ sheet, userId, batchId, initialReview }: { initialReview?: Review; sheet: Sheet; userId: string; batchId?: string }) {
  const router = useRouter(); const base = `/api/sheets/${sheet.id}/imports`;
  const [workflow, setWorkflow] = useState<Workflow>(initialReview ? { kind: initialReview.state === "committed" ? "result" : "review", review: initialReview } : { kind: "file" });
  const [file, setFile] = useState<File | null>(null); const [accountId, setAccountId] = useState(() => preferredImportAccount(sheet.accounts, ""));
  const [draft, setDraft] = useState<MappingDraft>(blankMapping); const [profiles, setProfiles] = useState<z.infer<typeof profilesSchema>>([]); const [profileId, setProfileId] = useState("");
  const preferenceKey = importPreferenceKey(userId, sheet.id);
  const preferences = useRef(emptyImportPreferences());
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState("");
  const [profileSequence, setProfileSequence] = useState(0);
  const [sourceView, setSourceView] = useState<"collapsed" | "locked" | "editing">("collapsed");
  const [preview, setPreview] = useState<z.infer<typeof parsedPreviewSchema> | null>(null); const [validated, setValidated] = useState("");
  const [pending, setPending] = useState(false); const [resuming, setResuming] = useState(Boolean(batchId && !initialReview));
  const [pendingMessage, setPendingMessage] = useState("Saving your choices");
  const [resumeSequence, setResumeSequence] = useState(0);
  const [message, setMessage] = useState(""); const [success, setSuccess] = useState(""); const [unavailable, setUnavailable] = useState(false);
  const [profileConflict, setProfileConflict] = useState(false); const [missing, setMissing] = useState(false);
  const [outcome, setOutcome] = useState<"idle" | "checking" | "unknown">("idle");
  const [selectedRow, setSelectedRow] = useState<string | null>(null); const [changed, setChanged] = useState<string[]>([]); const [page, setPage] = useState(1);
  const [reviewPageSize, setReviewPageSize] = useState<ReviewPageSize>(defaultReviewPageSize);
  const reviewPaginationTop = useRef<HTMLElement>(null);
  const [bulkCategoryId, setBulkCategoryId] = useState(""); const [bulkBucketId, setBulkBucketId] = useState("");
  const [bulkConflict, setBulkConflict] = useState(false);
  const [inlineDrafts, setInlineDrafts] = useState<Record<string, InlineReviewDraft>>({});
  const [exit, setExit] = useState<{ kind: "reset" } | { kind: "detail"; rowId: string } | { kind: "navigate"; href: string } | null>(null);
  const inlineDirty = Object.keys(inlineDrafts).length > 0;
  const bypassUnload = useRef(false);
  const inFlight = useRef(false); const fileControl = useRef<HTMLInputElement | null>(null);
  const applyReview = useCallback((review: Review) => { setWorkflow({ kind: review.state === "committed" ? "result" : "review", review }); }, []);
  const permissionLoss = useCallback((status: number) => {
    setUnavailable(true); setInlineDrafts({}); setExit(null); setWorkflow({ kind: "file" }); setFile(null); setPreview(null); setDraft(blankMapping); setProfiles([]); setSelectedRow(null); setBulkCategoryId(""); setBulkBucketId(""); setBulkConflict(false); setMessage(""); setSuccess("");
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
    if (!batchId || (initialReview && resumeSequence === 0)) return; let alive = true;
    async function resume() { setResuming(true); try { const response = await fetch(`${base}/${batchId}`, { cache: "no-store" }); await checkResponse(response); const review = reviewSchema.parse(await response.json()); if (alive) { applyReview(review); setMissing(false); } } catch (e) { if (alive) setMessage(e instanceof Error ? e.message : "Could not resume this import. Try again."); } finally { if (alive) setResuming(false); } }
    void resume(); return () => { alive = false; };
  }, [batchId, base, applyReview, checkResponse, resumeSequence, initialReview]);
  useEffect(() => {
    const kickoff = setTimeout(() => {
      try { preferences.current = readImportPreferences(window.localStorage, preferenceKey); }
      catch { preferences.current = emptyImportPreferences(); }
      setAccountId(preferredImportAccount(sheet.accounts, preferences.current.accountId));
      setPreferencesReady(true);
    }, 0);
    return () => clearTimeout(kickoff);
  }, [preferenceKey, sheet.accounts]);
  useEffect(() => {
    if (!preferencesReady || !accountId) return;
    let alive = true;
    async function loadProfiles() {
      try {
        const response = await fetch(`${base}/profiles?accountId=${accountId}`, { cache: "no-store" });
        if (!alive) return;
        await checkResponse(response);
        const data = profilesSchema.parse(await response.json()).filter((profile) => profile.accountId === accountId);
        if (!alive) return;
        const selected = preferredImportProfile(data, accountId, preferences.current.profileIds[accountId]);
        setProfiles(data); setProfileId(selected?.id ?? ""); setDraft(selected ? mappingDraft(selected.mapping) : blankMapping);
        setSourceView("collapsed"); setProfilesError("");
      } catch (error) { if (alive) setProfilesError(error instanceof Error ? error.message : "Could not load saved CSV import formats."); }
      finally { if (alive) setProfilesLoading(false); }
    }
    void loadProfiles(); return () => { alive = false; };
  }, [accountId, base, checkResponse, preferencesReady, profileSequence]);
  function rememberSource(account: string, profile?: string) {
    preferences.current = { accountId: account, profileIds: { ...preferences.current.profileIds, ...(profile ? { [account]: profile } : {}) } };
    try { window.localStorage.setItem(preferenceKey, JSON.stringify(preferences.current)); }
    catch { /* Defaults still work when browser storage is unavailable. */ }
  }
  useEffect(() => {
    function unload(e: BeforeUnloadEvent) { if (!bypassUnload.current && (pending || selectedRow || outcome !== "idle" || inlineDirty)) { e.preventDefault(); e.returnValue = ""; } }
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [pending, selectedRow, outcome, inlineDirty]);
  useEffect(() => {
    if (!inlineDirty && !pending) return;
    function leaving(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      event.preventDefault(); event.stopPropagation();
      if (inFlight.current) { setMessage("Wait for the row review to finish saving before leaving."); return; }
      setExit({ kind: "navigate", href: anchor.href });
    }
    function buttonNavigation(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const request = z.object({ href: z.string().startsWith("/") }).safeParse(event.detail);
      if (!request.success || new URL(request.data.href, window.location.href).origin !== window.location.origin) return;
      event.preventDefault();
      if (inFlight.current) { setMessage("Wait for the row review to finish saving before leaving."); return; }
      setExit({ kind: "navigate", href: request.data.href });
    }
    document.addEventListener("click", leaving, true);
    window.addEventListener(appNavigationEvent, buttonNavigation);
    return () => { document.removeEventListener("click", leaving, true); window.removeEventListener(appNavigationEvent, buttonNavigation); };
  }, [inlineDirty, pending]);
  async function action(operation: () => Promise<void>, label = "Saving your choices") {
    if (inFlight.current) return; inFlight.current = true; setPendingMessage(label); setPending(true); setMessage(""); setSuccess("");
    try { await operation(); } catch (e) { setMessage(e instanceof z.ZodError ? "Choose every required column, date format, decimal format, and amount convention." : e instanceof Error ? e.message : "Could not connect. Your entries are preserved. Try again."); }
    finally { setPending(false); inFlight.current = false; }
  }
  function chooseFile(next: File | null) { setPreview(null); setValidated(""); setMessage(""); setMissing(false); setFile(next); if (next && next.size > importLimits.fileBytes) setMessage("Choose a CSV no larger than 2 MiB."); }
  async function upload(mapped: boolean, persist = false) {
    if (!file || !accountId) throw new Error("Choose a file and an active transaction account.");
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
      await checkResponse(response); const saved = profilesSchema.element.parse(await response.json()); setProfiles((current) => [...current.filter((p) => p.id !== saved.id), saved]); setProfileId(saved.id); rememberSource(accountId, saved.id); setSourceView("collapsed"); setProfileConflict(false); setSuccess("CSV import format saved.");
    });
  }
  async function reloadProfiles() {
    await action(async () => { const response = await fetch(`${base}/profiles?accountId=${accountId}`, { cache: "no-store" }); await checkResponse(response); const latest = profilesSchema.parse(await response.json()); setProfiles(latest); const profile = latest.find((p) => p.id === profileId); if (!profile) throw new Error("This CSV import format is unavailable. Keep your choices or choose another CSV import format."); setDraft(mappingDraft(profile.mapping)); setSourceView("collapsed"); setPreview(null); setValidated(""); setProfileConflict(false); setSuccess("Latest saved CSV import format loaded."); });
  }
  async function reloadReview(): Promise<Review | undefined> {
    if (workflow.kind !== "review" && workflow.kind !== "result") return;
    try { const response = await fetch(`${base}/${workflow.review.id}`, { cache: "no-store" }); await checkResponse(response); const latest = reviewSchema.parse(await response.json()); applyReview(latest); setMissing(false); setBulkConflict(false); return latest; }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not reload this review. Your entries are preserved."); }
  }
  async function saveRow(input: Record<string, unknown>) {
    if (workflow.kind !== "review" || inFlight.current) return; inFlight.current = true; setPendingMessage("Saving row review"); setPending(true); setMessage("");
    try {
      const response = await fetch(`${base}/${workflow.review.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: workflow.review.version, ...input }) });
      await checkResponse(response); const review = reviewSchema.parse(await response.json()); applyReview(review); setSelectedRow(null); setInlineDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== input.rowId))); setSuccess("Row changes saved. Resolve any remaining invalid rows or duplicate decisions.");
    } finally { setPending(false); inFlight.current = false; }
  }
  async function applyBulkAllocation() {
    if (workflow.kind !== "review" || inlineDirty || outcome !== "idle" || missing || bulkConflict || (!bulkCategoryId && !bulkBucketId) || workflow.review.repeatedFile) return;
    await action(async () => {
      setPendingMessage("Applying allocations to eligible rows");
      const response = await fetch(`${base}/${workflow.review.id}/allocation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: workflow.review.version, ...(bulkCategoryId ? { categoryId: bulkCategoryId } : {}), ...(bulkBucketId ? { bucketId: bulkBucketId } : {}) }) });
      if (response.status === 409) {
        const raw: unknown = await response.json(); const stale = bulkAllocationResult.safeParse(raw);
        if (stale.success && stale.data.kind === "stale") {
          const refreshed = stale.data;
          applyReview(refreshed.review); setChanged(refreshed.changedRowIds);
          const firstIndex = refreshed.review.rows.findIndex((row) => refreshed.changedRowIds.includes(row.id));
          if (firstIndex >= 0) setPage(Math.floor(firstIndex / reviewPageSize) + 1);
          setMessage("Data changed since this preview. No allocations were applied. Check the highlighted rows and duplicate decisions, then apply again. Your bulk choices are preserved.");
        } else {
          setBulkConflict(true); setMessage("Someone changed this review. Your bulk choices are preserved. Reload latest review before applying again.");
        }
        return;
      }
      await checkResponse(response); const result = bulkAllocationResult.parse(await response.json());
      if (result.kind !== "updated") throw new Error("Reload this review before applying allocations again.");
      applyReview(result.review); setChanged([]);
      setSuccess(`Allocations applied across the entire file: ${result.updated} updated · ${result.skipped} skipped · ${result.unchanged} already matched. No transactions have been imported.`);
    });
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
    if (workflow.kind !== "review" || outcome !== "idle" || inlineDirty) return; const review = workflow.review;
    await action(async () => {
      try {
        const response = await fetch(`${base}/${review.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: review.version }) });
        if (response.status === 409) {
          const raw: unknown = await response.json(); const stale = confirmSchema.safeParse(raw);
          if (stale.success && stale.data.kind === "stale") {
            applyReview(stale.data.review); setChanged(stale.data.changedRowIds);
            const changedRows = stale.data.review.rows.filter((r) => stale.data.changedRowIds.includes(r.id));
            const firstIndex = stale.data.review.rows.findIndex((r) => stale.data.changedRowIds.includes(r.id)); if (firstIndex >= 0) setPage(Math.floor(firstIndex / reviewPageSize) + 1);
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
  function reset() { setBulkCategoryId(""); setBulkBucketId(""); setBulkConflict(false); setInlineDrafts({}); setExit(null); setWorkflow({ kind: "file" }); setFile(null); setPreview(null); setValidated(""); setProfileConflict(false); setSourceView("collapsed"); setProfilesLoading(Boolean(accountId)); setProfileSequence((value) => value + 1); setSelectedRow(null); setPage(1); setChanged([]); setMissing(false); setMessage(""); setSuccess(""); router.replace(`/import`); }
  const stage = workflow.kind === "file" ? 1 : workflow.kind === "mapping" ? 2 : workflow.kind === "review" ? 3 : 4;
  const review = workflow.kind === "review" || workflow.kind === "result" ? workflow.review : null;
  const reviewWindow = reviewPageWindow({ total: review?.rows.length ?? 0, page, pageSize: reviewPageSize });
  function changeReviewPage(nextPage: number) {
    const direction = nextPage > reviewWindow.page ? "next" : "previous";
    setPage(nextPage);
    requestAnimationFrame(() => {
      const top = reviewPaginationTop.current;
      const button = top?.querySelector<HTMLButtonElement>(`[data-review-direction="${direction}"]`);
      if (button && !button.disabled) button.focus({ preventScroll: true });
      else top?.focus({ preventScroll: true });
      top?.scrollIntoView({ block: "start" });
    });
  }
  function changeReviewPageSize(nextSize: ReviewPageSize) {
    setPage(resizedReviewPage({ page: reviewWindow.page, previousSize: reviewPageSize, nextSize }));
    setReviewPageSize(nextSize);
  }
  const row = review?.rows.find((r) => r.id === selectedRow);
  const selectedProfile = profiles.find((profile) => profile.id === profileId && profile.accountId === accountId);
  const sourceLocked = Boolean(selectedProfile) && sourceView !== "editing";
  const missingColumns = sourceLocked && selectedProfile && workflow.kind === "mapping" ? missingMappingColumns(selectedProfile.mapping, workflow.inspection.headers) : [];
  const activeAccounts = sheet.accounts.filter((a) => !a.isArchived);
  function updateDraft(key: keyof MappingDraft, value: string) { setDraft((current) => ({ ...current, [key]: value })); setPreview(null); setValidated(""); }
  function column(label: string, key: "date" | "payee" | "sourceId" | "amount" | "debit" | "credit", optional = false) {
    if (workflow.kind !== "mapping") return null;
    return <Selector id={`mapping-${key}`} label={label} value={draft[key]} onChange={(e) => updateDraft(key, e.target.value)}><option value="">{optional ? "No source ID column" : "Choose column"}</option>{draft[key] && !workflow.inspection.headers.includes(draft[key]) && <option value={draft[key]}>{draft[key]} (missing from this file)</option>}{workflow.inspection.headers.map((name) => <option key={name} value={name}>{name}</option>)}</Selector>;
  }
  async function saveInlineReview(row: ReviewRow) {
    try { await saveRow(inlineReviewInput(row, inlineDrafts[row.id] ?? inlineReviewDraft(row), sheet)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this row. Your entries are preserved."); }
  }
  function changeInline(row: ReviewRow, next: InlineReviewDraft) {
    setInlineDrafts((current) => inlineReviewChanged(row, next) ? { ...current, [row.id]: next } : Object.fromEntries(Object.entries(current).filter(([id]) => id !== row.id)));
  }
  function discardInlineDraft(id: string) { setInlineDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))); }
  function openFullReview(row: ReviewRow) {
    if (inlineDrafts[row.id]) setExit({ kind: "detail", rowId: row.id });
    else setSelectedRow(row.id);
  }
  function discardAndContinue() {
    if (!exit) return;
    if (exit.kind === "detail") { discardInlineDraft(exit.rowId); setSelectedRow(exit.rowId); setExit(null); }
    else if (exit.kind === "reset") reset();
    else { bypassUnload.current = true; window.location.assign(exit.href); }
  }
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  return <div className="import-screen"><ol className="import-steps" aria-label="Import progress">{["File and transaction account", "CSV import format", "Review", "Result"].map((label, i) => <li key={label} className={stage === i + 1 ? "current" : ""} aria-current={stage === i + 1 ? "step" : undefined}>{i + 1}. {label}</li>)}</ol>
    {message && <Notice tone="error">{message}</Notice>}{batchId && workflow.kind === "file" && !resuming && message && !missing && <Button onClick={() => setResumeSequence((s) => s + 1)}>Retry loading import</Button>}{success && <Notice>{success}</Notice>}{pending && <Notice>{outcome === "checking" ? "Checking import status" : pendingMessage}</Notice>}
    {resuming ? <LoadingState /> : workflow.kind === "file" ? !activeAccounts.length ? <EmptyState title="Add a transaction account first" action={<Link className="button primary" href={`/settings`}>Open Settings</Link>}>CSV transactions need an active transaction account. Add one in Settings, then return to Import.</EmptyState> : <Panel><h2>Choose a file and transaction account</h2><Selector id="import-account" label="Transaction account" value={accountId} disabled={pending || !preferencesReady} onChange={(e) => { if (e.target.value === accountId) return; setAccountId(e.target.value); rememberSource(e.target.value); setProfileConflict(false); setMessage(""); setSuccess(""); setProfilesLoading(Boolean(e.target.value)); setProfilesError(""); setSourceView("collapsed"); setProfiles([]); setProfileId(""); setDraft(blankMapping); setPreview(null); setValidated(""); }}><option value="">Choose transaction account</option>{activeAccounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</Selector>
      {profilesLoading && accountId && <Notice>Loading saved CSV import formats...</Notice>}{profilesError && <><Notice tone="warning">{profilesError} You can continue with an explicit CSV import format.</Notice><Button disabled={pending || profilesLoading} onClick={() => { setProfilesLoading(true); setProfilesError(""); setProfileSequence((value) => value + 1); }}>Retry saved CSV import formats</Button></>}
      <div className="import-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!pending) chooseFile(e.dataTransfer.files[0] ?? null); }}><p>Drop a CSV here, or choose a file.</p><input ref={fileControl} id="import-file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} aria-describedby="import-limits" aria-label="Choose CSV file" /><Button disabled={pending} onClick={() => fileControl.current?.click()}>Choose CSV file</Button></div>
      <p id="import-limits" className="hint">UTF-8 CSV · Maximum 2 MiB and 5,000 data rows.</p>{file && <p>{file.name} · {file.size.toLocaleString()} bytes · {sheet.accounts.find((a) => a.id === accountId)?.name ?? "Choose transaction account"}</p>}<Button variant="primary" pending={pending} disabled={!file || !accountId || !preferencesReady || profilesLoading || file.size > importLimits.fileBytes} onClick={() => void action(async () => { rememberSource(accountId, profileId); setWorkflow({ kind: "mapping", inspection: inspectionSchema.parse(await upload(false)) }); })}>Continue to CSV import format</Button>{missing && <Button onClick={reset}>Choose another file</Button>}</Panel>
      : workflow.kind === "mapping" ? <><Panel><h2>CSV import format</h2><p>{file?.name} · {workflow.inspection.rowCount.toLocaleString()} rows · {sheet.accounts.find((a) => a.id === accountId)?.name}</p><fieldset className="editor-fields" disabled={pending}>
        <Selector id="import-profile" label="Saved CSV import format" value={profileId} onChange={(e) => { setProfileId(e.target.value); rememberSource(accountId, e.target.value); setProfileConflict(false); setSourceView("collapsed"); const profile = profiles.find((p) => p.id === e.target.value); setDraft(profile ? mappingDraft(profile.mapping) : blankMapping); setPreview(null); setValidated(""); }}><option value="">Create an explicit CSV import format</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · version {p.version}</option>)}</Selector></fieldset>
        {missingColumns.length > 0 && <Notice tone="warning">This saved CSV import format uses columns missing from this file: {missingColumns.join(", ")}. Edit CSV import format or choose another CSV import format.</Notice>}
        <SourceConfiguration mode={selectedProfile ? sourceView : "new"} pending={pending} name={selectedProfile?.name ?? ""} onEdit={() => setSourceView("editing")} onInspect={() => setSourceView((view) => view === "locked" ? "collapsed" : "locked")}><Field id="mapping-profile-name" label="CSV import format name" value={draft.profile} maxLength={80} onChange={(e) => updateDraft("profile", e.target.value)} hint="A CSV import format tells Homebooks how to read columns, dates, and amounts. It is saved for this transaction account. Choose the date that should determine spending month." />
        <div className="import-mapping-grid">{column("Spending date column", "date")}{column("Payee / description column", "payee")}{column("Stable source ID column (optional)", "sourceId", true)}<Selector id="mapping-date-format" label="Date format" value={draft.dateFormat} onChange={(e) => updateDraft("dateFormat", e.target.value)}><option value="">Choose date format</option>{["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].map((f) => <option key={f}>{f}</option>)}</Selector><Selector id="mapping-decimal" label="Decimal separator" value={draft.decimalSeparator} onChange={(e) => updateDraft("decimalSeparator", e.target.value)}><option value="">Choose decimal format</option><option value=".">Period (12.34)</option><option value=",">Comma (12,34)</option></Selector><Selector id="mapping-money-mode" label="Amount columns" value={draft.mode} onChange={(e) => updateDraft("mode", e.target.value)}><option value="">Choose amount convention</option><option value="signed">One signed amount column</option><option value="debit-credit">Separate debit and credit columns</option></Selector>{draft.mode === "signed" ? <>{column("Amount column", "amount")}<Selector id="mapping-outflow" label="Outflow sign" value={draft.outflowSign} onChange={(e) => updateDraft("outflowSign", e.target.value)}><option value="">Choose outflow sign</option><option value="negative">Purchases are negative</option><option value="positive">Purchases are positive</option></Selector></> : draft.mode === "debit-credit" ? <>{column("Debit column", "debit")}{column("Credit column", "credit")}<Selector id="mapping-unused" label="Unused debit / credit cell" value={draft.unused} onChange={(e) => updateDraft("unused", e.target.value)}><option value="">Choose unused-cell policy</option><option value="blank">Must be blank</option><option value="blank-or-zero">Blank or zero</option></Selector></> : null}</div></SourceConfiguration>
        {profileConflict && <Notice tone="warning">The saved CSV import format changed. Your CSV import format choices are preserved. Reload saved CSV import format to replace them explicitly.</Notice>}<div className="actions import-actions">{!sourceLocked && <Button disabled={pending} onClick={() => void saveProfile()}>Save CSV import format</Button>}{profileConflict && <Button disabled={pending} onClick={() => void reloadProfiles()}>Reload saved CSV import format</Button>}<Button pending={pending} disabled={missingColumns.length > 0} onClick={() => void action(async () => { setPreview(parsedPreviewSchema.parse(await upload(true))); setValidated(JSON.stringify(draft)); })}>Validate CSV import format</Button></div></Panel>
        <ImportPreview key={JSON.stringify(draft) + validated} inspection={workflow.inspection} preview={preview} currency={sheet.currency} dateColumn={draft.date} payeeColumn={draft.payee} /><div className="actions import-actions"><Button disabled={pending} onClick={() => setWorkflow({ kind: "file" })}>Back to file and transaction account</Button><Button variant="primary" pending={pending} disabled={!preview || validated !== JSON.stringify(draft) || profileConflict} onClick={() => void action(async () => { const review = reviewSchema.parse(await upload(true, true)); rememberSource(accountId, review.profileId); applyReview(review); router.replace(`/import?batchId=${review.id}`); })}>Continue to review</Button></div></>
      : review && workflow.kind === "result" && review.result ? <Panel><h2>{review.result.repeatedFile ? "This file was already imported" : "Import complete"}</h2><p>{review.result.added} added · {review.result.skipped} skipped · {review.result.excluded} excluded</p><div className="actions import-actions"><Link className="button primary" href={`/transactions?batchId=${review.result.viewBatchId}`}>View imported transactions</Link><Button onClick={reset}>Import another file</Button></div></Panel>
      : review && <><p>{sheet.accounts.find((a) => a.id === review.accountId)?.name} · {review.mapping.profile}</p><div className="import-counts">{[{ label: "New", count: review.counts.new }, { label: "Already imported", count: review.counts.definite }, { label: "Needs review", count: review.counts.possible }, { label: "Invalid / excluded", count: `${review.counts.invalid} / ${review.counts.excluded}` }].map(({ label, count }) => <Panel key={label}><p>{label}</p><strong>{count}</strong></Panel>)}</div>
        {review.repeatedFile ? <Notice>This file was already imported. No transactions will be added.</Notice> : <Notice>Valid rows are ready to import with their proposed values, Uncategorized spending category, and Unassigned spending group unless you edit them. Individual review is optional. Resolve invalid rows and possible duplicates before importing. Card payments are Transfers; income and transfers do not count as spending.</Notice>}
        {inlineDirty && <Notice>{Object.keys(inlineDrafts).length} rows have unsaved changes. Drafts are kept when paging or reloading; save or discard them before importing or applying allocations.</Notice>}
        {!review.repeatedFile && <ImportBulkAllocation sheet={sheet} categoryId={bulkCategoryId} bucketId={bulkBucketId} disabled={pending || outcome !== "idle" || missing || inlineDirty} conflict={bulkConflict} onCategory={setBulkCategoryId} onBucket={setBulkBucketId} onApply={() => void applyBulkAllocation()} onReload={() => void action(async () => { await reloadReview(); })} />}
        <Panel><ImportReviewPagination position="top" navigationRef={reviewPaginationTop} window={reviewWindow} pageSize={reviewPageSize} disabled={pending || outcome !== "idle" || missing} onPage={changeReviewPage} onPageSize={changeReviewPageSize} /><div className="import-review-list">{review.rows.slice(reviewWindow.start, reviewWindow.end).map((item) => <ImportReviewRow key={item.id} row={item} sheet={sheet} draft={inlineDrafts[item.id]} pending={pending || outcome !== "idle" || missing} repeated={review.repeatedFile} changed={changed.includes(item.id)} onChange={(next) => changeInline(item, next)} onSave={() => void saveInlineReview(item)} onFullReview={() => openFullReview(item)} onUseLatest={() => discardInlineDraft(item.id)} onKeepEdits={() => { const current = inlineDrafts[item.id]; if (current) changeInline(item, { ...current, baseline: reviewRowSignature(item), decision: item.matching.status === "possible" ? "pending" : current.decision }); }} />)}</div>
          <ImportReviewPagination position="bottom" window={reviewWindow} pageSize={reviewPageSize} disabled={pending || outcome !== "idle" || missing} onPage={changeReviewPage} onPageSize={changeReviewPageSize} /></Panel>
        <footer className="import-footer"><p>{outcome !== "idle" ? "The outcome is uncertain. Verify batch status before retrying." : review.ready && review.counts.added === 0 ? "Nothing new to import" : `${review.counts.added} to add · ${review.counts.skipped} skipped · ${review.counts.excluded} excluded`}</p><div className="actions import-actions">{outcome !== "idle" ? <Button pending={outcome === "checking"} onClick={() => void action(() => verifyStatus(review.id))}>Check import status</Button> : <><Button variant="primary" pending={pending} disabled={!review.ready || Boolean(selectedRow) || missing || inlineDirty} onClick={() => void confirm()}>{review.ready && review.counts.added === 0 ? "Done" : `Import ${review.counts.added} ${review.counts.added === 1 ? "transaction" : "transactions"}`}</Button><Button disabled={pending} onClick={() => void action(async () => { await reloadReview(); })}>Reload latest review</Button><Button disabled={pending} onClick={() => inlineDirty ? setExit({ kind: "reset" }) : reset()}>Choose another file</Button></>}</div></footer>
      </>}
    {exit && <Dialog open title="Unsaved row changes" onClose={() => setExit(null)} pending={pending}><p>{exit.kind === "detail" ? "Save this row inline first, or discard its inline changes before opening Full review. Other row drafts are kept." : "Save your inline row reviews before leaving, or discard the unsaved changes."}</p><div className="actions import-actions"><Button onClick={() => setExit(null)}>Keep editing</Button><Button variant="danger" onClick={discardAndContinue}>{exit.kind === "detail" ? "Discard row changes and open Full review" : "Discard changes and continue"}</Button></div></Dialog>}
    {row && workflow.kind === "review" && <ImportRowEditor key={row.id} sheet={sheet} row={row} pending={pending} onClose={() => setSelectedRow(null)} onSave={saveRow} onReload={reloadReview} />}
  </div>;
}
