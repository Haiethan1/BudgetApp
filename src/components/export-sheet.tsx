"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { dateSchema } from "../ledger/input";
import { Button, Field, Notice, Panel, Selector, Help } from "./ui";
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
      setSuccess("Workbook downloaded.");
    } catch { setError("Could not connect. Your export choices are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <div id="export-sheet"><Panel><div className="help-label"><h2>Export sheet</h2><Help label="Export sheet"><p>Download a workbook for Excel or Google Sheets. Tabs include transactions, allocations, budgets, debts, and repayments.</p><p>Date ranges filter transactions and repayments. Budgets include full overlapping periods. Debt balances and linked sources always include all dates; configuration history stays included.</p><p>Exact money text preserves every minor unit. Very large amounts omit numeric values to avoid rounding. Dates remain date-only text.</p></Help></div><form onSubmit={download} aria-busy={pending} noValidate><Selector id="export-scope" label="Export scope" value={kind} onChange={event => { setKind(event.target.value); setError(""); setSuccess(""); }} disabled={pending}><option value="all">All data</option><option value="range">Date range</option></Selector>{kind === "range" && <div className="form-grid"><Field id="export-from" label="Start date (included)" type="date" required value={from} onChange={event => setFrom(event.target.value)} disabled={pending}/><Field id="export-to" label="End date (included)" type="date" required value={to} onChange={event => setTo(event.target.value)} disabled={pending}/></div>}{error && <Notice tone="error">{error}</Notice>}{success && <Notice>{success}</Notice>}<div className="actions"><Button type="submit" variant="primary" pending={pending}>{pending ? "Preparing workbook…" : "Download Excel workbook"}</Button></div></form></Panel></div>;
}
