"use client";
import { useRef, useState } from "react";
import { searchInput } from "../sharing/input";
import { responseMessage, searchResultsSchema } from "../sharing/presentation";
import { Button, Field, Notice } from "./ui";
import { sheetFailure } from "./sheet-access";

export function SharingDialog({ sheet, onPending, onManage }: { sheet: { id: string; name: string }; onPending: (pending: boolean) => void; onManage: () => void }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<ReturnType<typeof searchResultsSchema.parse>["people"] | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const focusFallback = useRef<HTMLButtonElement>(null);
  async function checkAccess(response: Response) {
    return !await sheetFailure(response, sheet.id);
  }
  async function search(event?: React.FormEvent) {
    event?.preventDefault(); if (inFlight.current) return;
    const parsed = searchInput.safeParse(query); setError(""); setFieldError("");
    if (!parsed.success) { setFieldError(parsed.error.issues[0]?.message ?? "Check the display name."); return; }
    inFlight.current = true; setBusy("search"); onPending(true); setPeople(null);
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/sharing/search?q=${encodeURIComponent(parsed.data)}`, { cache: "no-store" });
      if (!(await checkAccess(response))) return;
      if (!response.ok) { setError(await responseMessage(response, "Could not search. Try again.")); return; }
      setPeople(searchResultsSchema.parse(await response.json()).people);
    } catch { setError("Could not search. Check your connection and retry."); }
    finally { inFlight.current = false; setBusy(""); onPending(false); }
  }
  async function invite(id: string) {
    if (inFlight.current || sent.includes(id)) return;
    inFlight.current = true; setBusy(id); onPending(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/sharing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "invite", userId: id }) });
      if (!(await checkAccess(response))) return;
      if (!response.ok) { setError(await responseMessage(response, "Could not send the invitation. Try again.")); return; }
      setSent((previous) => [...previous, id]);
      window.dispatchEvent(new Event("homebooks-sharing-changed"));
      requestAnimationFrame(() => focusFallback.current?.focus());
    } catch { setError("Could not send the invitation. Your search is preserved. Try again."); }
    finally { inFlight.current = false; setBusy(""); onPending(false); }
  }
  return <><p>Members can view and edit the whole sheet after they accept.</p><form onSubmit={search} noValidate aria-busy={Boolean(busy)}><Field autoFocus id="share-search" label="Search by display name" hint="Enter at least two characters. Results show usernames to distinguish people with the same name." value={query} maxLength={80} disabled={Boolean(busy)} error={fieldError} onChange={(event) => { setQuery(event.target.value); setPeople(null); setError(""); setFieldError(""); }} /><Button type="submit" variant="primary" pending={busy === "search"} disabled={Boolean(busy)}>Search people</Button></form>{error && <><Notice tone="error">{error}</Notice>{people === null && <Button disabled={Boolean(busy)} onClick={() => void search()}>Retry search</Button>}</>}{busy === "search" && <Notice>Searching people…</Notice>}{people && people.length === 0 && <p className="sharing-space">No matching people. Try another display name.</p>}{people?.map((person) => <div className="setting-row" key={person.id}><div><strong>{person.name}</strong><p className="hint">@{person.username}</p></div>{sent.includes(person.id) ? <BadgeSent /> : <Button disabled={Boolean(busy)} pending={busy === person.id} onClick={() => void invite(person.id)}>Invite <span className="sr-only">{person.name} @{person.username}</span></Button>}</div>)}<div className="sharing-space"><Button ref={focusFallback} disabled={Boolean(busy)} onClick={onManage}>Manage people in Settings</Button></div></>;
}
function BadgeSent() { return <Notice>Invitation sent</Notice>; }
