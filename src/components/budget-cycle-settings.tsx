"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { budgetCycle, currentCycleMonth, cycleRangeLabel, cycleStartDaySchema } from "../sheets/cycle";
import { responseMessage } from "@/sharing/presentation";
import { Dialog } from "./dialog";
import { Button, Notice, Panel, Selector } from "./ui";
import { sheetFailure } from "./sheet-access";

type Sheet = ReturnType<typeof readSheet>;
const configurationSchema = z.object({ cycleStartDay: cycleStartDaySchema, cycleVersion: z.number().int().positive() });
export function BudgetCycleSettings({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ startDay: number; version: number } | null>(null);
  const [day, setDay] = useState(sheet.cycleStartDay);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(false);
  const inFlight = useRef(false);
  async function save() {
    if (!editor || inFlight.current || conflict) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "budgetCycle", startDay: day, version: editor.version }) });
      if (await sheetFailure(response, sheet.id)) return;
      if (!response.ok) { setConflict(response.status === 409); setMessage(await responseMessage(response, "Could not save the cycle. Your choice is preserved. Try again.")); return; }
      setEditor(null); setSuccess("Budget cycle saved. Reports now use the new dates."); router.refresh();
    } catch { setMessage("Could not connect. Your choice is preserved. Try again."); }
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
      setEditor({ startDay: parsed.data.cycleStartDay, version: parsed.data.cycleVersion }); setDay(parsed.data.cycleStartDay); setConflict(false); setReload(false); setMessage(""); router.refresh();
    } catch { setMessage("Could not reload. Your choice is preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const previewMonth = currentCycleMonth();
  return <Panel><h2>Monthly budget cycle</h2>{success && <Notice>{success}</Notice>}<div className="setting-row"><div><strong>Starts on day {sheet.cycleStartDay} each month</strong><p className="hint">{cycleRangeLabel(budgetCycle(currentCycleMonth(sheet.cycleStartDay), sheet.cycleStartDay))}</p></div>{sheet.role === "owner" && <Button onClick={() => { setEditor({ startDay: sheet.cycleStartDay, version: sheet.cycleVersion }); setDay(sheet.cycleStartDay); setMessage(""); setConflict(false); setReload(false); }}>Edit budget cycle</Button>}</div><p className="hint">Ends the day before the next monthly start. Short months use their last day, then return to your chosen day. Only the owner can change this setting.</p>{editor && <Dialog open title={reload ? "Reload latest budget cycle?" : "Monthly budget cycle"} dirty={day !== editor.startDay} pending={pending} onClose={() => setEditor(null)}>{message && <Notice tone="error">{message}</Notice>}{reload ? <><p>Your unsaved choice will be discarded and replaced with the latest setting.</p><div className="actions"><Button disabled={pending} onClick={() => setReload(false)}>Keep editing</Button><Button pending={pending} onClick={() => void reloadLatest()}>Discard changes and reload</Button></div></> : <form onSubmit={(event) => { event.preventDefault(); void save(); }}><Selector id="budget-cycle-day" label="Monthly start day" value={day} disabled={pending || conflict} onChange={(event) => setDay(Number(event.target.value))}>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>Day {index + 1}</option>)}</Selector><p className="hint">If a month has fewer days, its cycle starts on the last day. For example, day 31 uses February 28 (29 in a leap year), then March 31.</p><p><strong>Example cycle</strong><br />{cycleRangeLabel(budgetCycle(previewMonth, day))}</p><Notice tone="warning">Changing this setting regroups spending in all reports, including past months. Monthly budget overrides stay with their original start-month labels. Transaction dates and limit amounts stay the same.</Notice><p className="hint">Each cycle is labeled by the month it starts. The end date is calculated automatically so consecutive cycles have no gaps or overlaps.</p><div className="actions">{conflict && <Button disabled={pending} onClick={() => setReload(true)}>Reload latest</Button>}<Button type="submit" variant="primary" pending={pending} disabled={conflict}>Save budget cycle</Button></div></form>}</Dialog>}</Panel>;
}
