"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "../sheets/service";
import { expenseDraft, gridDetails, gridTransaction, isGridExpense, remainingUnderMe, type ExpenseDraft } from "../ledger/expense-grid";
import { ledgerRecordSchema, type Draft, type LedgerRecord } from "../ledger/presentation";
import { notifyFirstEntry } from "../sheets/guide";
import { appNavigationEvent } from "./navigation-guard";

type Attempt = { url: string; method: "POST" | "PUT"; body: string };
type SaveState = { kind: "idle" | "conflict" | "missing" | "loading" } | { kind: "pending" | "uncertain"; attempt: Attempt };
type Row = { record: LedgerRecord | null; draft: ExpenseDraft; baseline: string; focus: string; sequence: number };
export function useExpenseRow({ sheet, onSaved, onUnavailable, onDetails }: {
  sheet: ReturnType<typeof readSheet>; onSaved: () => void; onUnavailable: (status: number) => void;
  onDetails: (record: LedgerRecord | null, detail?: { draft: Draft; hint: string }) => void;
}) {
  const router = useRouter();
  const [row, setRow] = useState<Row | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [message, setMessage] = useState("");
  const [exit, setExit] = useState<(() => void) | null>(null);
  const inFlight = useRef(false);
  const blocked = state.kind === "pending" || state.kind === "uncertain" || state.kind === "loading";
  const dirty = Boolean(row && JSON.stringify(row.draft) !== row.baseline);
  const category = sheet.categories.find(item => item.isProtected), me = sheet.buckets.find(item => item.isProtected);
  function request(action: () => void) {
    if (blocked || inFlight.current) { setMessage("Resolve the current save before leaving this row."); return; }
    if (dirty) { setExit(() => action); return; }
    action();
  }
  const clear = useCallback(() => { setRow(null); setState({ kind: "idle" }); setMessage(""); }, []);
  function open(record: LedgerRecord | null, focus = "payee", accountId = "") {
    request(() => {
      if (record && !isGridExpense(record)) { clear(); onDetails(record); return; }
      const active = sheet.accounts.filter(item => !item.isArchived);
      if (!record && !active.length) { clear(); onDetails(null); return; }
      const selected = active.some(item => item.id === accountId) ? accountId : active.length === 1 ? active[0]?.id : "";
      const draft = expenseDraft({ record, currency: sheet.currency, accountId: selected });
      setRow({ record, draft, baseline: JSON.stringify(draft), focus, sequence: Date.now() }); setState({ kind: "idle" }); setMessage("");
    });
  }
  function change(draft: ExpenseDraft) { if (!blocked) { setRow(current => current ? { ...current, draft } : current); setMessage(""); } }
  function cancel() { request(clear); }
  function details() {
    if (!row || !category || !me || blocked) return;
    try { const next = gridDetails(row.draft, row.record, sheet.currency, { categoryId: category.id, bucketId: me.id }); next.hint += ` Requested person totals: ${Object.entries(row.draft.shares).filter(([, amount]) => amount !== "").map(([id, amount]) => `${sheet.buckets.find(person => person.id === id)?.name ?? "Historical person"}: ${amount} ${sheet.currency}`).join("; ")}.`; clear(); onDetails(row.record, next); }
    catch { setMessage("Complete Total and share amounts before moving this draft to Details. You can cancel the row to open its saved details."); }
  }
  function fillMe() {
    if (!row || !me) return;
    try { change(remainingUnderMe(row.draft, sheet.currency, me.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check the amounts first."); }
  }
  async function send(attempt: Attempt) {
    if (inFlight.current) return;
    inFlight.current = true; setState({ kind: "pending", attempt }); setMessage("");
    try {
      const response = await fetch(attempt.url, { method: attempt.method, headers: { "Content-Type": "application/json" }, body: attempt.body });
      if (response.status === 401) { clear(); onUnavailable(401); return; }
      if (response.status === 404) {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (access.status === 401 || access.status === 404) { clear(); onUnavailable(access.status); return; }
        if (!access.ok) throw new Error("Could not verify access");
        setState({ kind: "missing" }); setMessage("This transaction is no longer available. Your row draft is preserved; cancel to return to Expenses."); return;
      }
      if (response.status >= 500) throw new Error("Unknown save outcome");
      if (!response.ok) {
        const reply = z.object({ message: z.string() }).safeParse(await response.json());
        setState({ kind: response.status === 409 ? "conflict" : "idle" });
        setMessage(reply.success ? reply.data.message : "Check the row fields. Your draft is preserved."); return;
      }
      ledgerRecordSchema.parse(await response.json());
      if (!row?.record) notifyFirstEntry(sheet.id, { kind: "manual", description: row?.draft.payee ?? "" });
      const create = !row?.record, accountId = row?.draft.accountId;
      clear(); onSaved();
      if (create) {
        const draft = expenseDraft({ record: null, currency: sheet.currency, accountId });
        setRow({ record: null, draft, baseline: JSON.stringify(draft), focus: "payee", sequence: Date.now() });
      }
    } catch { setState({ kind: "uncertain", attempt }); setMessage("Could not verify whether this row saved. Retry the same save before changing or leaving it."); }
    finally { inFlight.current = false; }
  }
  function save() {
    if (!row || !category || blocked || state.kind === "conflict" || state.kind === "missing") return;
    try {
      const input = gridTransaction(row.draft, row.record, sheet.currency, category.id);
      void send({ url: `/api/sheets/${sheet.id}/transactions${row.record ? `/${row.record.id}` : ""}`, method: row.record ? "PUT" : "POST", body: JSON.stringify({ ...input, requestId: crypto.randomUUID(), ...(row.record ? { version: row.record.version } : {}) }) });
    } catch (error) { setMessage(error instanceof z.ZodError ? error.issues.map(issue => issue.message).join(" ") : error instanceof Error ? error.message : "Check the row fields."); }
  }
  function reload() {
    if (!row?.record) return;
    const id = row.record.id;
    request(() => { void (async () => {
      if (inFlight.current) return;
      inFlight.current = true; setState({ kind: "loading" }); setMessage("");
      try {
        const response = await fetch(`/api/sheets/${sheet.id}/transactions/${id}`, { cache: "no-store" });
        if (response.status === 401) { clear(); onUnavailable(401); return; }
        if (response.status === 404) {
          const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
          if (access.status === 401 || access.status === 404) { clear(); onUnavailable(access.status); return; }
          if (!access.ok) throw new Error("Could not verify access");
          setState({ kind: "missing" }); setMessage("This transaction was deleted. Your draft is preserved."); return;
        }
        if (!response.ok) { setState({ kind: "conflict" }); setMessage("Could not reload the latest transaction. Your draft is preserved."); return; }
        const record = ledgerRecordSchema.parse(await response.json());
        if (!isGridExpense(record)) { clear(); onDetails(record); return; }
        const draft = expenseDraft({ record, currency: sheet.currency });
        setRow({ record, draft, baseline: JSON.stringify(draft), focus: "payee", sequence: Date.now() }); setState({ kind: "idle" }); setMessage("");
      } catch { setState({ kind: "conflict" }); setMessage("Could not reload the latest transaction. Your draft is preserved."); }
      finally { inFlight.current = false; }
    })(); });
  }
  useEffect(() => {
    if (!dirty && !blocked) return;
    function unload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    function leaving(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault(); event.stopPropagation();
      if (blocked || inFlight.current) setMessage("Resolve the current save before leaving this row.");
      else setExit(() => () => { clear(); router.push(anchor.href); });
    }
    function navigation(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const parsed = z.object({ href: z.string().startsWith("/") }).safeParse(event.detail); if (!parsed.success) return;
      event.preventDefault();
      if (blocked || inFlight.current) setMessage("Resolve the current save before leaving this row.");
      else setExit(() => () => { clear(); router.push(parsed.data.href); });
    }
    window.addEventListener("beforeunload", unload); document.addEventListener("click", leaving, true); window.addEventListener(appNavigationEvent, navigation);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", leaving, true); window.removeEventListener(appNavigationEvent, navigation); };
  }, [dirty, blocked, router, clear]);
  return { row, state, message, dirty, blocked, open, change, cancel, details, fillMe, save, reload, request, clear,
    retry: () => { if (state.kind === "uncertain") void send(state.attempt); }, exit, keepEditing: () => setExit(null), discard: () => { const action = exit; setExit(null); clear(); action?.(); } };
}
