"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { responseMessage, sharingPageSchema } from "../sharing/presentation";
import type { readSheet } from "@/sheets/service";
import { Dialog } from "./dialog";
import { loseSheetAccess, requestShare, sheetFailure } from "./sheet-access";
import { Badge, Button, Notice, Panel } from "./ui";

type Sheet = ReturnType<typeof readSheet>;
type Confirmation = { kind: "removeMember"; userId: string; name: string } | { kind: "revokeInvite"; inviteId: string; name: string } | { kind: "leave" };
export function PeopleSettings({ sheet }: { sheet: Sheet }) {
  const [data, setData] = useState<ReturnType<typeof sharingPageSchema.parse> | null>(null);
  const [loading, setLoading] = useState(sheet.role === "owner");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (sheet.role !== "owner") return;
    const id = ++sequence.current; setLoading(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/sharing`, { cache: "no-store" });
      if (id !== sequence.current) return;
      if (await sheetFailure(response, sheet.id)) return;
      if (!response.ok) { setError(await responseMessage(response, "Could not load people. Try again.")); return; }
      setData(sharingPageSchema.parse(await response.json()));
    } catch { if (id === sequence.current) setError("Could not load people. Check your connection and retry."); }
    finally { if (id === sequence.current) setLoading(false); }
  }, [sheet.id, sheet.role]);
  useEffect(() => { const counter = sequence; const kickoff = setTimeout(() => void load(), 0); const reload = () => { void load(); }; window.addEventListener("homebooks-sharing-changed", reload); return () => { counter.current++; clearTimeout(kickoff); window.removeEventListener("homebooks-sharing-changed", reload); }; }, [load]);
  function confirm(next: Confirmation) { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setConfirmation(next); setMessage(""); }
  async function submit() {
    if (!confirmation || inFlight.current) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/sharing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(confirmation) });
      if (await sheetFailure(response, sheet.id)) return;
      if (!response.ok) { setMessage(await responseMessage(response, "Could not change sharing. Try again.")); return; }
      if (confirmation.kind === "leave") { loseSheetAccess(sheet.id, 404); return; }
      setMessage(confirmation.kind === "removeMember" ? `${confirmation.name} no longer has access. They need a new invitation to return.` : `Invitation to ${confirmation.name} revoked.`);
      setConfirmation(null); await load();
      requestAnimationFrame(() => { if (!trigger.current?.isConnected) panel.current?.querySelector<HTMLElement>("h2")?.focus(); });
    } catch { setMessage("Could not connect. Your action can be retried safely."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const people = data?.people ?? sheet.people;
  return <div ref={panel}><Panel><div className="panel-heading"><h2 id="people-heading" tabIndex={-1}>People</h2>{sheet.role === "owner" && <Button onClick={requestShare}>Invite someone</Button>}</div>{message && !confirmation && <Notice>{message}</Notice>}{people.map((person) => <div className="setting-row" key={person.id}><div><strong>{person.name}</strong><p className="hint">@{person.username}</p></div><div className="actions"><Badge>{person.role === "owner" ? "Owner" : "Member"}</Badge>{sheet.role === "owner" && person.role === "member" && <Button variant="danger" onClick={() => confirm({ kind: "removeMember", userId: person.id, name: person.name })}>Remove <span className="sr-only">{person.name} @{person.username}</span></Button>}</div></div>)}{sheet.role === "owner" ? <><h3>Pending invitations</h3>{loading && <Notice>Loading invitations…</Notice>}{error && <><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry people</Button></>}{!loading && !error && data?.invites.length === 0 && <p>No pending invitations.</p>}{data?.invites.map((invite) => <div className="setting-row" key={invite.id}><div><strong>{invite.name}</strong><p className="hint">@{invite.username}</p><Badge>Pending invitation</Badge></div><Button variant="danger" onClick={() => confirm({ kind: "revokeInvite", inviteId: invite.id, name: invite.name })}>Revoke <span className="sr-only">invitation to {invite.name} @{invite.username}</span></Button></div>)}</> : <><p className="hint">Members can view and edit the whole sheet. Only the owner manages invitations and access.</p><Button variant="danger" onClick={() => confirm({ kind: "leave" })}>Leave sheet</Button></>}</Panel>{confirmation && <Dialog open title={confirmation.kind === "leave" ? `Leave ${sheet.name}?` : confirmation.kind === "removeMember" ? `Remove ${confirmation.name}?` : `Revoke invitation to ${confirmation.name}?`} onClose={() => { setConfirmation(null); setMessage(""); }} pending={pending} returnFocus={trigger}>{message && <Notice tone="error">{message}</Notice>}<p>{confirmation.kind === "leave" ? "You will lose access to this sheet. Your transactions remain, and you will need a new invitation to return." : confirmation.kind === "removeMember" ? "They will lose access on their next operation. Their transactions remain, and they will need a new invitation to return." : "They will no longer be able to accept this invitation."}</p><div className="actions"><Button disabled={pending} onClick={() => { setConfirmation(null); setMessage(""); }}>Cancel</Button><Button variant="danger" pending={pending} onClick={() => void submit()}>{confirmation.kind === "leave" ? "Leave sheet" : confirmation.kind === "removeMember" ? "Remove member" : "Revoke invitation"}</Button></div></Dialog>}</div>;
}
