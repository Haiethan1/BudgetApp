"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { type listSheets } from "@/sheets/service";

export function SheetSwitcher({ sheets, selected }: { sheets: ReturnType<typeof listSheets>; selected: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function select(id: string) {
    if (inFlight.current || id === selected) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${id}/select`, { method: "POST" });
      if (response.status === 401) { router.replace("/sign-in?expired=1"); router.refresh(); return; }
      if (!response.ok) {
        const reply = z.object({ message: z.string() }).safeParse(await response.json());
        setError(reply.success ? reply.data.message : "Could not switch sheets. Try again.");
        return;
      }
      router.push(`/sheets/${id}`); router.refresh();
    } catch { setError("Could not connect. Try switching sheets again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <div className="sheet-switcher" aria-busy={pending}>
    <div className="field"><label htmlFor="sheet-switcher">Current sheet</label><select id="sheet-switcher" disabled={pending}
      value={selected} onChange={(event) => select(event.target.value)}>{sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name} · {sheet.role === "owner" ? "Owner" : "Shared"}</option>)}</select></div>
    {pending && <p role="status">Switching sheet…</p>}{error && <p className="notice error" role="alert">{error}</p>}
    <Link href="/sheets/new">Create sheet</Link>
  </div>;
}
