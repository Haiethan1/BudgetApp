"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { currentPeriod, resolvePeriod, cycleRangeLabel, cycleStartDaySchema, historySchema, simpleCycleSchedule } from "../sheets/cycle";
import { responseMessage } from "@/sharing/presentation";
import { Dialog } from "./dialog";
import { Button, Notice, Panel, Selector } from "./ui";
import { sheetFailure } from "./sheet-access";

type Sheet = ReturnType<typeof readSheet>;
const configurationSchema = z.object({ cycleStartDay: cycleStartDaySchema, cycleVersion: z.number().int().positive(), cycleHistory: historySchema });
export function BudgetCycleSettings({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const [editor, setEditor] = useState<z.infer<typeof configurationSchema> | null>(null);
  const [day, setDay] = useState(sheet.cycleStartDay), [futureOnly, setFutureOnly] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false), [reload, setReload] = useState(false);
  const inFlight = useRef(false);
  function initialize(configuration: z.infer<typeof configurationSchema>) {
    setEditor(configuration); setDay(configuration.cycleStartDay); setFutureOnly(false); setConflict(false); setReload(false); setMessage("");
  }
  async function submit() {
    if (!editor || inFlight.current || conflict) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const input = { kind: "setBudgetCycle", startDay: day, futureOnly, version: editor.cycleVersion };
      const send = (body: unknown) => fetch(`/api/sheets/${sheet.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const preview = await send({ ...input, preview: true });
      if (await sheetFailure(preview, sheet.id)) return;
      if (!preview.ok) { setConflict(preview.status === 409); setMessage(await responseMessage(preview, "Could not check this cycle. Your choices are preserved.")); return; }
      const { previewToken } = z.object({ previewToken: z.string() }).parse(await preview.json());
      const response = await send({ ...input, previewToken });
      if (await sheetFailure(response, sheet.id)) return;
      if (!response.ok) { setConflict(response.status === 409); setMessage(await responseMessage(response, "Could not save the cycle. Your choices are preserved.")); return; }
      setEditor(null); setSuccess(futureOnly ? "Billing cycle saved. Current and previous cycles are unchanged." : "Billing cycle saved for all periods."); router.refresh();
    } catch { setMessage("Could not confirm the save. Your choices are preserved. Retry, or reload the latest setting."); }
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
  let error = "", dates: ReturnType<typeof simpleCycleSchedule> | null = null;
  if (editor) try { dates = simpleCycleSchedule(editor, day, futureOnly); } catch (e) { error = e instanceof Error ? e.message : "Choose a valid cycle."; }
  return <div id="budget-cycle"><Panel><h2>Billing cycle</h2>{success && <Notice>{success}</Notice>}<div className="setting-row"><div><strong>Monthly start day {sheet.cycleStartDay}</strong><p className="hint">Current period: {cycleRangeLabel(resolvePeriod(currentPeriod(sheet), sheet))}</p></div>{sheet.role === "owner" && <Button onClick={() => initialize(sheet)}>Edit billing cycle</Button>}</div>
    {editor && <Dialog open title={reload ? "Reload latest billing cycle?" : "Change billing cycle"} dirty={day !== editor.cycleStartDay || futureOnly} pending={pending} onClose={() => setEditor(null)}>
      {message && <Notice tone="error">{message}</Notice>}
      {reload ? <><p>Discard your choices and load the latest billing cycle?</p><div className="actions"><Button disabled={pending} onClick={() => setReload(false)}>Keep editing</Button><Button pending={pending} onClick={() => void reloadLatest()}>Discard and reload</Button></div></> : <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <Selector id="budget-cycle-day" label="Monthly start day" value={day} disabled={pending || conflict} onChange={e => setDay(Number(e.target.value))}>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>Day {index + 1}</option>)}</Selector>
        <label className="checkbox-row"><input type="checkbox" checked={futureOnly} disabled={pending || conflict} onChange={e => setFutureOnly(e.target.checked)} />Only affect future cycles</label>
        <p className="hint">{futureOnly ? "Current and previous cycles stay unchanged." : "Applies to all cycles, including the current and previous months."}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {dates && <p aria-live="polite">{futureOnly ? "First future cycle" : "Current cycle after saving"}<br />{cycleRangeLabel(futureOnly ? dates.firstNewPeriod : dates.currentAfter)}</p>}
        <details><summary>How this affects budgets</summary><p>Transactions keep their dates. Saved limits keep their amounts and move to the new cycle dates. Short months use their last day. Upcoming payment plans adjust to the new schedule.</p></details>
        <div className="actions"><Button type="submit" variant="primary" pending={pending} disabled={conflict || Boolean(error)}>Save billing cycle</Button>{conflict && <Button disabled={pending} onClick={() => setReload(true)}>Reload latest</Button>}</div>
      </form>}
    </Dialog>}
  </Panel></div>;
}
