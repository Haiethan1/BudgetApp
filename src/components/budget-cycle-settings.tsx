"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { currentPeriod, resolvePeriod, cycleRangeLabel, cycleStartDaySchema, historySchema, previewCycleChange, budgetCycle, shiftMonth, today } from "../sheets/cycle";
import { cyclePreviewSchema } from "../sheets/cycle-preview";
import { displayAmount } from "../ledger/presentation";
import { responseMessage } from "@/sharing/presentation";
import { Dialog } from "./dialog";
import { Button, Field, Notice, Panel, Selector } from "./ui";
import { sheetFailure } from "./sheet-access";

type Sheet = ReturnType<typeof readSheet>;
const configurationSchema = z.object({ cycleStartDay: cycleStartDaySchema, cycleVersion: z.number().int().positive(), cycleHistory: historySchema });
export function BudgetCycleSettings({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const [editor, setEditor] = useState<z.infer<typeof configurationSchema> | null>(null);
  const [day, setDay] = useState(sheet.cycleStartDay);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [transition, setTransition] = useState<"short" | "long">("short");
  const [preview, setPreview] = useState<z.infer<typeof cyclePreviewSchema> | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(false);
  const inFlight = useRef(false);
  function initialize(configuration: z.infer<typeof configurationSchema>) {
    setEditor(configuration); setDay(configuration.cycleStartDay); setEffectiveDate(budgetCycle(shiftMonth(today().slice(0,7), 2), configuration.cycleStartDay).from); setTransition("short"); setPreview(null); setConflict(false); setReload(false); setMessage("");
  }
  async function submit(isPreview: boolean) {
    if (!editor || inFlight.current || conflict) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "budgetCycle", startDay: day, effectiveDate, transition, version: editor.cycleVersion, preview: isPreview, previewToken: preview?.previewToken }) });
      if (await sheetFailure(response, sheet.id)) return;
      if (!response.ok) { setConflict(response.status === 409); setPreview(null); setMessage(await responseMessage(response, "Could not save the cycle. Your choices are preserved. Try again.")); return; }
      if (isPreview) { setPreview(cyclePreviewSchema.parse(await response.json())); return; }
      setEditor(null); setSuccess("Budget cycle saved. Completed periods are unchanged."); router.refresh();
    } catch { setMessage("Could not connect. Your choices are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function reloadLatest() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
      if (await sheetFailure(response, sheet.id)) return;
      const parsed = configurationSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      initialize(parsed.data); router.refresh();
    } catch { setMessage("Could not reload. Your choices are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  let localError = "";
  let localPreview: ReturnType<typeof previewCycleChange> | null = null;
  if (editor) try { localPreview = previewCycleChange(editor, { startDay: day, effectiveDate, transition }); } catch (error) { localError = error instanceof Error ? error.message : "Check the dates."; }
  const dates = preview ?? localPreview;
  return <div id="budget-cycle"><Panel><h2>Budget cycle</h2>{success && <Notice>{success}</Notice>}<div className="setting-row"><div><strong>Scheduled start day {sheet.cycleStartDay}</strong><p className="hint">Current period: {cycleRangeLabel(resolvePeriod(currentPeriod(sheet), sheet))}</p></div>{sheet.role === "owner" && <Button onClick={() => initialize(sheet)}>Edit budget cycle</Button>}</div><p className="hint">One cycle applies to every transaction account in this sheet. Short months clamp to their last day. Only the owner can change the schedule.</p>{sheet.cycleHistory.revisions.length > 0 && <details><summary>Cycle history</summary>{sheet.cycleHistory.revisions.map((row) => <p key={row.recurringFrom}>Transition starts {row.transitionFrom}. Day {row.startDay} recurs from {row.recurringFrom}.</p>)}</details>}{editor && <Dialog open title={reload ? "Reload latest budget cycle?" : "Change budget cycle"} dirty pending={pending} onClose={() => setEditor(null)}>{message && <Notice tone="error">{message}</Notice>}{reload ? <><p>Your unsaved choices will be discarded and replaced with the latest setting.</p><div className="actions"><Button disabled={pending} onClick={() => setReload(false)}>Keep editing</Button><Button pending={pending} onClick={() => void reloadLatest()}>Discard changes and reload</Button></div></> : <form onSubmit={(event) => { event.preventDefault(); void submit(false); }}><Selector id="budget-cycle-day" label="Monthly start day" value={day} disabled={pending || conflict} onChange={(event) => { setDay(Number(event.target.value)); setPreview(null); }}>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>Day {index + 1}</option>)}</Selector><Field id="budget-cycle-effective" type="date" label="First new recurring start" value={effectiveDate} min="0001-01-02" max="9999-12-31" disabled={pending || conflict} onChange={(event) => { setEffectiveDate(event.target.value); setPreview(null); }} hint="Choose today or later in UTC, on your new start day. Day 31 uses February 28, or 29 in a leap year." /><Selector id="budget-cycle-transition" label="One-time transition" value={transition} disabled={pending || conflict} onChange={(event) => { const parsed = z.enum(["short", "long"]).parse(event.target.value); setTransition(parsed); setPreview(null); }}><option value="short">Shorter period</option><option value="long">Longer period</option></Selector>{localError && <Notice tone="warning">{localError}</Notice>}{dates && <div aria-live="polite"><p>Original affected period<br />{cycleRangeLabel(dates.original)}</p><p>{dates.transitionKind === "aligned" ? "Aligned boundary. Preceding period unchanged" : "One-time transition"}<br />{cycleRangeLabel(dates.transition)}</p><p>New recurring period<br />{cycleRangeLabel(dates.next)}</p><p>Current period before<br />{cycleRangeLabel(dates.currentBefore)}</p><p>Current period after<br />{cycleRangeLabel(dates.currentAfter)}</p></div>}<Notice tone="warning">{dates?.transitionKind === "aligned" ? "The new schedule starts on an existing boundary. The preceding period and its limits stay unchanged. The first recurring period keeps its existing limit." : "The transition keeps its existing limits in full."} No automatic prorating. Future overrides move in order to the new successor periods, with their amounts, zero limits, no-limit choices and inheritance unchanged. Preview their exact dates before saving. Transactions keep their dates. Completed periods stay unchanged.</Notice>{preview && <><h3>{preview.transitionKind === "aligned" ? "Unchanged preceding period limits" : "Retained transition limits"}</h3>{preview.retainedLimits.length === 0 ? <p>No limits set.</p> : preview.retainedLimits.map((row) => <p key={row.category}><strong>{row.category}</strong>: {row.limit === null ? "No limit" : displayAmount(row.limit, sheet.currency)}{row.inheritsDefault ? " (recurring default)" : " (explicit override)"}</p>)}<h3>Retained and future override mapping</h3>{preview.mappings.length === 0 ? <p>No future overrides to move.</p> : preview.mappings.map((mapping, index) => <div className="setting-row" key={index}><div><strong>{mapping.category}</strong><p>{mapping.inheritsDefault ? `Inherits recurring default: ${mapping.effectiveLimit === null ? "No limit" : displayAmount(mapping.effectiveLimit, sheet.currency)}` : mapping.limit === null ? "Explicit no limit" : displayAmount(mapping.limit, sheet.currency)}</p><p>From {cycleRangeLabel(mapping.oldPeriod)}</p><p>To {cycleRangeLabel(mapping.newPeriod)}</p></div></div>)}</>}<p className="hint">A current period can shorten or lengthen. Reports regroup dates within that affected period. Choose a later effective date to keep the current period unchanged. Existing recurring defaults apply in full; individual period limits can be edited in Budgets after saving.</p><div className="actions">{conflict && <Button disabled={pending} onClick={() => setReload(true)}>Reload latest</Button>}<Button disabled={conflict || Boolean(localError) || pending} onClick={() => void submit(true)}>Preview dates and limits</Button><Button type="submit" variant="primary" pending={pending} disabled={conflict || !preview || Boolean(localError)}>Save budget cycle</Button></div></form>}</Dialog>}</Panel></div>;
}
