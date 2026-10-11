"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Notice } from "./ui";

export function LegacySheetLink({ sheetId, destination }: { sheetId: string; destination: string }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function open() {
      try {
        const response = await fetch(`/api/sheets/${sheetId}/select`, { method: "POST" });
        if (!active) return;
        if (response.status === 401) { window.location.replace("/sign-in?expired=1"); return; }
        if (!response.ok) { setError("Could not open this sheet. Check your access and try again."); return; }
        window.location.replace(destination);
      } catch { if (active) setError("Could not connect. Try opening this sheet again."); }
    }
    void open();
    return () => { active = false; };
  }, [sheetId, destination, attempt]);
  return <main className="sheet-page">{error ? <><Notice tone="error">{error}</Notice><Button onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry</Button><Link href="/">Back to Homebooks</Link></> : <Notice>Opening your sheet…</Notice>}</main>;
}
