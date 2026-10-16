"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { dateSchema } from "../ledger/input";
import { Button, Field, Notice, Panel, Selector } from "./ui";
import { sheetFailure } from "./sheet-access";

export function ExportSheet({ sheetId }: { sheetId: string }) {
  const [kind, setKind] = useState("all"), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const inFlight = useRef(false);
  async function download(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(""); setSuccess("");
    if (kind === "range" && (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to)) { setError("Choose real start and end dates, with the start on or before the end."); return; }
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(`/api/sheets/${sheetId}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "all" ? { kind } : { kind, from, to }) });
      if (await sheetFailure(response, sheetId)) return;
      if (!response.ok) {
        const reply = z.object({ message: z.string() }).safeParse(await response.json());
        setError(reply.success ? reply.data.message : "Could not export this sheet. Try again."); return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "homebooks-export.xlsx"; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSuccess("Workbook downloaded. Open it in Excel or import it into Google Sheets. Export info explains each tab and its scope.");
    } catch { setError("Could not connect. Your export choices are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <div id="export-sheet"><Panel><h2>Export sheet</h2><p className="hint">Download an Excel workbook for this sheet. Open it in Excel or import it into Google Sheets. Separate tabs contain transactions, split details, budgets, debts and repayment history when data exists.</p><p className="hint">Dates filter transactions and repayment events. Budgets include whole periods that overlap your dates, with full-period spending and planning. Debt balances and linked sources are always an all-time snapshot. Configuration history stays included. Archived whole-expense repayment dates and comments stay included as context and never add to repayment totals.</p><p className="hint">Exact money text columns preserve every minor unit. Very large amounts have blank numeric cells to avoid Excel rounding. Dates remain date-only text.</p><form onSubmit={download} aria-busy={pending} noValidate><Selector id="export-scope" label="Export scope" value={kind} onChange={event => { setKind(event.target.value); setError(""); setSuccess(""); }} disabled={pending}><option value="all">All data</option><option value="range">Date range</option></Selector>{kind === "range" && <div className="form-grid"><Field id="export-from" label="Start date (included)" type="date" required value={from} onChange={event => setFrom(event.target.value)} disabled={pending}/><Field id="export-to" label="End date (included)" type="date" required value={to} onChange={event => setTo(event.target.value)} disabled={pending}/></div>}{error && <Notice tone="error">{error}</Notice>}{success && <Notice>{success}</Notice>}<div className="actions"><Button type="submit" variant="primary" pending={pending}>{pending ? "Preparing workbook…" : "Download Excel workbook"}</Button></div></form></Panel></div>;
}
