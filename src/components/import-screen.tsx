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
function parseMapping(draft: MappingDraft) { return mappingSchema.parse({ version: 1, profile: draft.profile.trim() || "This import", date: draft.date, payee: draft.payee, ...(draft.sourceId ? { sourceId: draft.sourceId } : {}), dateFormat: draft.dateFormat, decimalSeparator: draft.decimalSeparator,
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
  const [rememberFormat, setRememberFormat] = useState(false);
  const [checking, setChecking] = useState(false); const [checkError, setCheckError] = useState("");
  const checkGeneration = useRef(0);
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
  const setupKey = JSON.stringify({ accountId, profileId, draft });
  const mappingStage = workflow.kind === "mapping";
  useEffect(() => {
    if (!mappingStage || !file || !accountId || inFlight.current) return;
    const generation = ++checkGeneration.current;
    let alive = true;
    const timer = setTimeout(async () => {
      let mapping: Mapping;
      try { mapping = parseMapping(draft); } catch { setChecking(false); return; }
      setPreview(null); setValidated(""); setCheckError("");
      setChecking(true);
      try {
        const body = new FormData(); body.set("file", file); body.set("accountId", accountId); body.set("mapping", JSON.stringify(mapping));
        const response = await fetch(`${base}/preview`, { method: "POST", body });
        if (!alive || generation !== checkGeneration.current) return;
        await checkResponse(response);
        const result = parsedPreviewSchema.parse(await response.json());
        if (!alive || generation !== checkGeneration.current) return;
        setPreview(result); setValidated(setupKey);
      } catch (error) {
        if (alive && generation === checkGeneration.current) setCheckError(error instanceof Error ? error.message : "Could not check this file. Continue to review to try again.");
      } finally { if (alive && generation === checkGeneration.current) setChecking(false); }
    }, 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [mappingStage, file, accountId, profileId, draft, setupKey, base, checkResponse, pending]);
  function invalidateCheck() { checkGeneration.current++; setChecking(false); setCheckError(""); setPreview(null); setValidated(""); }
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
  function chooseFile(next: File | null) { invalidateCheck(); setPreview(null); setValidated(""); setMessage(""); setMissing(false); setFile(next); if (next && next.size > importLimits.fileBytes) setMessage("Choose a CSV no larger than 2 MiB."); }
  async function upload(mapped: boolean, persist = false, sourceProfileId = profileId) {
    if (!file || !accountId) throw new Error("Choose a file and an active transaction account.");
    if (file.size > importLimits.fileBytes) throw new Error("Choose a CSV no larger than 2 MiB.");
    const body = new FormData(); body.set("file", file); body.set("accountId", accountId);
    if (mapped) body.set("mapping", JSON.stringify(parseMapping(draft))); if (persist && sourceProfileId) body.set("profileId", sourceProfileId);
    const response = await fetch(persist ? base : `${base}/preview`, { method: "POST", body }); await checkResponse(response); return response.json();
  }
  async function persistProfile() {
    if (!draft.profile.trim()) throw new Error("Enter a name to remember this CSV import format.");
    const profile = profiles.find((p) => p.id === profileId);
    const response = await fetch(`${base}/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, mapping: parseMapping(draft), ...(profile ? { id: profile.id, version: profile.version } : {}) }) });
    if (response.status === 409) setProfileConflict(true);
    await checkResponse(response);
    const saved = profilesSchema.element.parse(await response.json());
    setProfiles((current) => [...current.filter((p) => p.id !== saved.id), saved]); setProfileId(saved.id);
    rememberSource(accountId, saved.id); setSourceView("collapsed"); setProfileConflict(false); setRememberFormat(false);
    return saved.id;
  }
  async function saveProfile() { await action(async () => { await persistProfile(); setSuccess("CSV import format saved."); }); }
  async function continueToReview() {
    if (setupIncomplete || mappingColumnProblem || (rememberFormat && !draft.profile.trim())) {
      setMessage(sourceLocked ? "Edit CSV import format to replace missing headings, or choose another format before continuing." : "Complete the required choices above. Replace missing or repeated headings, and enter a format name if you chose to remember it.");
      document.querySelector<HTMLSelectElement | HTMLInputElement>('.import-screen [aria-invalid="true"]:not(:disabled)')?.focus();
      return;
    }
    await action(async () => {
      const generation = ++checkGeneration.current;
      setChecking(false); setCheckError("");
      if (!preview || validated !== setupKey) {
        setPendingMessage("Checking CSV import format against this file");
        const result = parsedPreviewSchema.parse(await upload(true));
        if (generation !== checkGeneration.current) return;
        setPreview(result); setValidated(setupKey);
      }
      const savedId = rememberFormat ? await persistProfile() : profileId;
      setPendingMessage("Preparing transaction review");
      const review = reviewSchema.parse(await upload(true, true, savedId));
      if (generation !== checkGeneration.current) return;
      rememberSource(accountId, savedId || undefined); applyReview(review); router.replace(`/import?batchId=${review.id}`);
    }, "Checking CSV import format against this file");
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
  function reset() { invalidateCheck(); setRememberFormat(false); setBulkCategoryId(""); setBulkBucketId(""); setBulkConflict(false); setInlineDrafts({}); setExit(null); setWorkflow({ kind: "file" }); setFile(null); setPreview(null); setValidated(""); setProfileConflict(false); setSourceView("collapsed"); setProfilesLoading(Boolean(accountId)); setProfileSequence((value) => value + 1); setSelectedRow(null); setPage(1); setChanged([]); setMissing(false); setMessage(""); setSuccess(""); router.replace(`/import`); }
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
  function updateDraft(key: keyof MappingDraft, value: string) { invalidateCheck(); setDraft((current) => ({ ...current, [key]: value })); setPreview(null); setValidated(""); }
  function fileExamples(column: string) {
    if (workflow.kind !== "mapping" || !column) return "Choose a heading to see values from your file.";
    const index = workflow.inspection.headers.indexOf(column);
    if (index < 0) return `The heading ${column} is missing from this file.`;
    const values = [...new Set(workflow.inspection.samples.map((row) => row.fields[index]?.trim() || "Blank"))].slice(0, 3);
    return `${column}: ${values.length ? values.join(" · ") : "No sample rows"}.`;
  }
  const amountExamples = draft.mode === "debit-credit" ? `${fileExamples(draft.debit)} ${fileExamples(draft.credit)}` : fileExamples(draft.amount);
  const setupIncomplete = !draft.date || !draft.payee || !draft.dateFormat || !draft.decimalSeparator || !draft.mode || (draft.mode === "signed" ? !draft.amount || !draft.outflowSign : draft.mode === "debit-credit" ? !draft.debit || !draft.credit || !draft.unused : true);
  const chosenColumns = [draft.date, draft.payee, draft.sourceId, ...(draft.mode === "debit-credit" ? [draft.debit, draft.credit] : draft.mode === "signed" ? [draft.amount] : [])].filter(Boolean);
  const mappingColumnProblem = workflow.kind === "mapping" && (chosenColumns.some((heading) => !workflow.inspection.headers.includes(heading)) || new Set(chosenColumns).size !== chosenColumns.length);
  function column(label: string, key: "date" | "payee" | "sourceId" | "amount" | "debit" | "credit", optional = false) {
    if (workflow.kind !== "mapping") return null;
    const keys: (keyof MappingDraft)[] = ["date", "payee", "sourceId"];
    if (draft.mode === "signed") keys.push("amount");
    else if (draft.mode === "debit-credit") keys.push("debit", "credit");
    const duplicate = draft[key] && keys.some((other) => other !== key && draft[other] === draft[key]);
    const explanation = key === "date" ? "Use the date the spending belongs to, rather than a later posting date." : key === "sourceId" ? "Use a unique transaction ID that stays the same in later exports. It helps recognize repeat imports. Leave this empty if the file has no stable ID." : key === "debit" ? "Purchases in this column become negative amounts. Use positive values for debit and credit columns." : key === "credit" ? "Money received in this column becomes positive amounts." : key === "payee" ? "This becomes the transaction description you see in Homebooks." : "Use the purchase sign choice below to tell Homebooks which amounts are spending.";
    return <Selector id={`mapping-${key}`} label={`${label} (${optional ? "optional" : "required"})`} aria-required={!optional} hint={`${optional && !draft[key] ? "No transaction ID selected." : fileExamples(draft[key])} ${explanation}`} error={!optional && !draft[key] ? "Choose the heading above that contains this detail." : draft[key] && !workflow.inspection.headers.includes(draft[key]) ? "This heading is missing. Choose a heading from this file." : duplicate ? "Choose a different heading for each transaction detail." : undefined} value={draft[key]} onChange={(e) => updateDraft(key, e.target.value)}><option value="">{optional ? "No transaction ID in this file" : "Choose a heading from your file"}</option>{draft[key] && !workflow.inspection.headers.includes(draft[key]) && <option value={draft[key]}>{draft[key]} (missing from this file)</option>}{workflow.inspection.headers.map((name, index) => <option key={name} value={name}>{name} · {(workflow.inspection.samples.find((row) => row.fields[index]?.trim())?.fields[index] || "Blank").slice(0, 60)}</option>)}</Selector>;
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
    {resuming ? <LoadingState /> : workflow.kind === "file" ? !activeAccounts.length ? <EmptyState title="Add a transaction account first" action={<Link className="button primary" href={`/settings`}>Open Settings</Link>}>CSV transactions need an active transaction account. Add one in Settings, then return to Import.</EmptyState> : <Panel><h2>Choose a file and transaction account</h2><Selector id="import-account" label="Transaction account (required)" aria-required hint="Imported transactions will belong to this transaction account." error={!accountId ? "Choose a transaction account before continuing." : undefined} value={accountId} disabled={pending || !preferencesReady} onChange={(e) => { if (e.target.value === accountId) return; invalidateCheck(); setRememberFormat(false); setAccountId(e.target.value); rememberSource(e.target.value); setProfileConflict(false); setMessage(""); setSuccess(""); setProfilesLoading(Boolean(e.target.value)); setProfilesError(""); setSourceView("collapsed"); setProfiles([]); setProfileId(""); setDraft(blankMapping); setPreview(null); setValidated(""); }}><option value="">Choose transaction account</option>{activeAccounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</Selector>
      {profilesLoading && accountId && <Notice>Loading saved CSV import formats...</Notice>}{profilesError && <><Notice tone="warning">{profilesError} You can continue with an explicit CSV import format.</Notice><Button disabled={pending || profilesLoading} onClick={() => { setProfilesLoading(true); setProfilesError(""); setProfileSequence((value) => value + 1); }}>Retry saved CSV import formats</Button></>}
      <div className="import-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!pending) chooseFile(e.dataTransfer.files[0] ?? null); }}><p>Drop a CSV here, or choose a file.</p><input ref={fileControl} id="import-file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} aria-describedby="import-limits" aria-required="true" aria-label="Choose CSV file (required)" /><Button disabled={pending} onClick={() => fileControl.current?.click()}>Choose CSV file</Button></div>
      <p id="import-limits" className="hint">UTF-8 CSV · Maximum 2 MiB and 5,000 data rows.</p>{file && <p>{file.name} · {file.size.toLocaleString()} bytes · {sheet.accounts.find((a) => a.id === accountId)?.name ?? "Choose transaction account"}</p>}<Button variant="primary" pending={pending} disabled={!file || !accountId || !preferencesReady || profilesLoading || file.size > importLimits.fileBytes} onClick={() => void action(async () => { rememberSource(accountId, profileId); setWorkflow({ kind: "mapping", inspection: inspectionSchema.parse(await upload(false)) }); })}>Continue to CSV import format</Button>{missing && <Button onClick={reset}>Choose another file</Button>}</Panel>
      : workflow.kind === "mapping" ? <><Panel><h2>Tell Homebooks where to find the transaction details in your file</h2><p className="hint">Choose the headings that contain each detail. Examples below come from your uploaded file. Choices marked required must be filled in before continuing.</p><p>{file?.name} · {workflow.inspection.rowCount.toLocaleString()} rows · {sheet.accounts.find((a) => a.id === accountId)?.name}</p><fieldset className="editor-fields" disabled={pending}>
        <Selector id="import-profile" label="Saved CSV import format (optional)" value={profileId} onChange={(e) => { invalidateCheck(); setRememberFormat(false); setProfileId(e.target.value); rememberSource(accountId, e.target.value); setProfileConflict(false); setSourceView("collapsed"); const profile = profiles.find((p) => p.id === e.target.value); setDraft(profile ? mappingDraft(profile.mapping) : blankMapping); setPreview(null); setValidated(""); }}><option value="">Set up this import</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · version {p.version}</option>)}</Selector></fieldset>
        {missingColumns.length > 0 && <Notice tone="warning">This saved CSV import format uses columns missing from this file: {missingColumns.join(", ")}. Edit CSV import format or choose another CSV import format.</Notice>}
        <SourceConfiguration mode={selectedProfile ? sourceView : "new"} pending={pending} name={selectedProfile?.name ?? ""} onEdit={() => setSourceView("editing")} onInspect={() => setSourceView((view) => view === "locked" ? "collapsed" : "locked")}><p className="hint">Check the examples against a purchase you recognize. Homebooks will not guess ambiguous dates or whether positive amounts are purchases. You can correct or exclude individual invalid rows in review.</p>{(selectedProfile || rememberFormat) && <Field id="mapping-profile-name" label="CSV import format name (required to remember)" aria-required value={draft.profile} maxLength={80} onChange={(e) => updateDraft("profile", e.target.value)} error={!draft.profile.trim() ? "Enter a name to remember this format." : undefined} hint="Use a name you will recognize when importing into this transaction account again." />}
        <div className="import-mapping-grid">{column("Spending date", "date")}{column("Payee / description", "payee")}{column("Transaction ID", "sourceId", true)}<Selector id="mapping-date-format" label="Date format (required)" aria-required hint={`${fileExamples(draft.date)} Year-month-day reads YYYY-MM-DD. Month/day/year reads MM/DD/YYYY; day/month/year reads DD/MM/YYYY. A date such as 03/04/2026 could mean March 4 or April 3. Choose the order used by your export.`} error={!draft.dateFormat ? "Choose the date order used in your file. Homebooks cannot decide between day and month for you." : undefined} value={draft.dateFormat} onChange={(e) => updateDraft("dateFormat", e.target.value)}><option value="">Choose date format</option>{["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].map((f) => <option key={f}>{f}</option>)}</Selector><Selector id="mapping-decimal" label="Decimal separator (required)" aria-required hint={`${amountExamples} Choose the mark between whole money units and their decimal part. Homebooks uses the sheet currency; it does not convert currencies.`} error={!draft.decimalSeparator ? "Choose period or comma to match the amounts in your file." : undefined} value={draft.decimalSeparator} onChange={(e) => updateDraft("decimalSeparator", e.target.value)}><option value="">Choose decimal format</option><option value=".">Period (12.34)</option><option value=",">Comma (12,34)</option></Selector><Selector id="mapping-money-mode" label="Amount columns (required)" aria-required hint={`${amountExamples} Choose one amount column when purchases and money received share a heading. Choose separate debit and credit when the file puts them under different headings. Each heading choice shows an actual file value.`} error={!draft.mode ? "Choose whether this file has one amount column or separate debit and credit columns." : undefined} value={draft.mode} onChange={(e) => updateDraft("mode", e.target.value)}><option value="">Choose amount convention</option><option value="signed">One signed amount column</option><option value="debit-credit">Separate debit and credit columns</option></Selector>{draft.mode === "signed" ? <>{column("Amount", "amount")}<Selector id="mapping-outflow" label="Purchase sign (required)" aria-required hint={`${fileExamples(draft.amount)} ${draft.outflowSign === "positive" ? "Homebooks reverses the signs in this file: positive purchases become negative spending, and negative amounts become money received." : draft.outflowSign === "negative" ? "Homebooks keeps the signs in this file: negative amounts are spending and positive amounts are money received." : "Check a purchase you recognize. Homebooks always stores spending as negative and money received as positive."}`} error={!draft.outflowSign ? "Choose the sign used for a purchase in your file. Homebooks will not guess from the first row." : undefined} value={draft.outflowSign} onChange={(e) => updateDraft("outflowSign", e.target.value)}><option value="">Choose outflow sign</option><option value="negative">Purchases are negative</option><option value="positive">Purchases are positive</option></Selector></> : draft.mode === "debit-credit" ? <>{column("Debit / purchases", "debit")}{column("Credit / money received", "credit")}<Selector id="mapping-unused" label="Unused debit / credit cell (required)" aria-required hint={`${amountExamples} For each transaction, only one column has an amount. Choose whether the other cell is blank or may contain zero. Rows with two amounts need correction in review.`} error={!draft.unused ? "Check the unused side of a purchase or credit, then choose blank or blank or zero." : undefined} value={draft.unused} onChange={(e) => updateDraft("unused", e.target.value)}><option value="">Choose unused-cell policy</option><option value="blank">Must be blank</option><option value="blank-or-zero">Blank or zero</option></Selector></> : null}</div></SourceConfiguration>
        {!selectedProfile && <label className="check"><input type="checkbox" checked={rememberFormat} disabled={pending} onChange={(event) => setRememberFormat(event.target.checked)} />Remember this format for future imports</label>}
        <p className="hint">{selectedProfile ? "Changes apply to this import. Use Update saved CSV import format only when you want future imports to use these changes." : "Remembering is optional. You can review this file without saving a reusable format."}</p>
        {profileConflict && <Notice tone="warning">The saved CSV import format changed. Your choices are preserved. Reload it before updating, or continue with these choices for this import only.</Notice>}
        <div className="actions import-actions">{selectedProfile && !sourceLocked && <Button disabled={pending} onClick={() => void saveProfile()}>Update saved CSV import format</Button>}{profileConflict && <Button disabled={pending} onClick={() => void reloadProfiles()}>Reload saved CSV import format</Button>}</div></Panel>
        {checking && <Notice>Checking CSV import format against this file...</Notice>}{checkError && <Notice tone="error">{checkError} Check your choices, then Continue to review to try again.</Notice>}
        <ImportPreview key={setupKey + validated} inspection={workflow.inspection} preview={validated === setupKey ? preview : null} currency={sheet.currency} dateColumn={draft.date} payeeColumn={draft.payee} moneyColumns={draft.mode === "debit-credit" ? [draft.debit, draft.credit] : [draft.amount]} sourceIdColumn={draft.sourceId} /><p className="hint" id="import-setup-guidance">{setupIncomplete || (rememberFormat && !draft.profile.trim()) ? "Before continuing, fill in the required choices above. Each missing choice has guidance beside it." : missingColumns.length ? "Before continuing, edit the saved format to replace its missing headings, or choose another format." : mappingColumnProblem ? "Before continuing, choose a different existing heading for each transaction detail. Check the guidance beside your choices." : "Continue to review checks these choices. Individual invalid rows can be corrected or excluded there; nothing is imported yet."}</p><div className="actions import-actions"><Button disabled={pending} onClick={() => { invalidateCheck(); setWorkflow({ kind: "file" }); }}>Back to file and transaction account</Button><Button variant="primary" pending={pending} aria-describedby="import-setup-guidance" onClick={() => void continueToReview()}>Continue to review</Button></div></>
      : review && workflow.kind === "result" && review.result ? <Panel><h2>{review.result.repeatedFile ? "This file was already imported" : "Import complete"}</h2><p>{review.result.added} added · {review.result.skipped} skipped · {review.result.excluded} excluded</p><div className="actions import-actions"><Link className="button primary" href={`/transactions?batchId=${review.result.viewBatchId}`}>View imported transactions</Link><Button onClick={reset}>Import another file</Button></div></Panel>
      : review && <><p>{sheet.accounts.find((a) => a.id === review.accountId)?.name} · {review.mapping.profile}</p><div className="import-counts">{[{ label: "New", count: review.counts.new }, { label: "Already imported", count: review.counts.definite }, { label: "Needs review", count: review.counts.possible }, { label: "Invalid / excluded", count: `${review.counts.invalid} / ${review.counts.excluded}` }].map(({ label, count }) => <Panel key={label}><p>{label}</p><strong>{count}</strong></Panel>)}</div>
        {review.repeatedFile ? <Notice>This file was already imported. No transactions will be added.</Notice> : <Notice>Valid rows are ready to import with their proposed values, Uncategorized spending category, and Unassigned spending group unless you edit them. Individual review is optional. Resolve invalid rows and possible duplicates before importing. Card payments are Transfers; income and transfers do not count as spending.</Notice>}
        {inlineDirty && <Notice>{Object.keys(inlineDrafts).length} rows have unsaved changes. Drafts are kept when paging or reloading; save or discard them before importing or applying allocations.</Notice>}
        {!review.repeatedFile && <ImportBulkAllocation sheet={sheet} categoryId={bulkCategoryId} bucketId={bulkBucketId} disabled={pending || outcome !== "idle" || missing || inlineDirty} conflict={bulkConflict} onCategory={setBulkCategoryId} onBucket={setBulkBucketId} onApply={() => void applyBulkAllocation()} onReload={() => void action(async () => { await reloadReview(); })} />}
        <Panel><ImportReviewPagination position="top" navigationRef={reviewPaginationTop} window={reviewWindow} pageSize={reviewPageSize} disabled={pending || outcome !== "idle" || missing} onPage={changeReviewPage} onPageSize={changeReviewPageSize} /><div className="import-review-list">{review.rows.slice(reviewWindow.start, reviewWindow.end).map((item) => <ImportReviewRow key={item.id} row={item} sheet={sheet} draft={inlineDrafts[item.id]} pending={pending || outcome !== "idle" || missing} repeated={review.repeatedFile} changed={changed.includes(item.id)} onChange={(next) => changeInline(item, next)} onSave={() => void saveInlineReview(item)} onFullReview={() => openFullReview(item)} onUseLatest={() => discardInlineDraft(item.id)} onKeepEdits={() => { const current = inlineDrafts[item.id]; if (current) changeInline(item, { ...current, baseline: reviewRowSignature(item), decision: item.matching.status === "possible" ? "pending" : current.decision }); }} />)}</div>
          <ImportReviewPagination position="bottom" window={reviewWindow} pageSize={reviewPageSize} disabled={pending || outcome !== "idle" || missing} onPage={changeReviewPage} onPageSize={changeReviewPageSize} /></Panel>
        <footer className="import-footer">{!review.ready && outcome === "idle" && <p className="hint">Required before importing: correct or exclude invalid rows and choose keep or skip for possible duplicates. Use the guidance beside each affected row.</p>}<p>{outcome !== "idle" ? "The outcome is uncertain. Verify batch status before retrying." : review.ready && review.counts.added === 0 ? "Nothing new to import" : `${review.counts.added} to add · ${review.counts.skipped} skipped · ${review.counts.excluded} excluded`}</p><div className="actions import-actions">{outcome !== "idle" ? <Button pending={outcome === "checking"} onClick={() => void action(() => verifyStatus(review.id))}>Check import status</Button> : <><Button variant="primary" pending={pending} disabled={!review.ready || Boolean(selectedRow) || missing || inlineDirty} onClick={() => void confirm()}>{review.ready && review.counts.added === 0 ? "Done" : `Import ${review.counts.added} ${review.counts.added === 1 ? "transaction" : "transactions"}`}</Button><Button disabled={pending} onClick={() => void action(async () => { await reloadReview(); })}>Reload latest review</Button><Button disabled={pending} onClick={() => inlineDirty ? setExit({ kind: "reset" }) : reset()}>Choose another file</Button></>}</div></footer>
      </>}
    {exit && <Dialog open title="Unsaved row changes" onClose={() => setExit(null)} pending={pending}><p>{exit.kind === "detail" ? "Save this row inline first, or discard its inline changes before opening Full review. Other row drafts are kept." : "Save your inline row reviews before leaving, or discard the unsaved changes."}</p><div className="actions import-actions"><Button onClick={() => setExit(null)}>Keep editing</Button><Button variant="danger" onClick={discardAndContinue}>{exit.kind === "detail" ? "Discard row changes and open Full review" : "Discard changes and continue"}</Button></div></Dialog>}
    {row && workflow.kind === "review" && <ImportRowEditor key={row.id} sheet={sheet} row={row} pending={pending} onClose={() => setSelectedRow(null)} onSave={saveRow} onReload={reloadReview} />}
  </div>;
}
