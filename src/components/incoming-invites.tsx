"use client";
import { useEffect, useRef, useState } from "react";
import { responseMessage, type IncomingInvite } from "../sharing/presentation";
import { restoreSheetAccess } from "./sheet-access";
import { Button, LoadingState, Notice } from "./ui";

export function IncomingInvites({ invites, loading, opening = false, error, retry, onResolved, onOpenSheet, onPending }: {
  invites: IncomingInvite[] | null; loading: boolean; opening?: boolean; error: string; retry: () => void;
  onResolved: (resolvedId?: string) => Promise<void>; onOpenSheet: (sheetId: string) => void; onPending: (pending: boolean) => void;
}) {
  const [outcomes, setOutcomes] = useState<{ invite: IncomingInvite; kind: "accepted" | "declined" }[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [focusOutcome, setFocusOutcome] = useState<string | null>(null);
  const inFlight = useRef(false);
  const resultFocus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusOutcome || busy || opening) return;
    const frame = requestAnimationFrame(() => {
      resultFocus.current?.querySelector<HTMLElement>(`[data-invite-result="${focusOutcome}"]`)?.focus();
      setFocusOutcome(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOutcome, busy, opening]);
  async function respond(invite: IncomingInvite, kind: "accept" | "decline") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(`${invite.id}:${kind}`); onPending(true); setMessage("");
    try {
      const response = await fetch(`/api/invites/${invite.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      if (response.status === 401) { window.location.replace("/sign-in?expired=1"); return; }
      if (!response.ok) { setMessage(await responseMessage(response, "Could not answer the invitation. Try again.")); if (response.status === 404 || response.status === 409) await onResolved(invite.id); return; }
      if (kind === "accept") restoreSheetAccess(invite.sheetId);
      setOutcomes((previous) => [...previous.filter((item) => item.invite.id !== invite.id), { invite, kind: kind === "accept" ? "accepted" : "declined" }]);
      await onResolved(invite.id);
      setFocusOutcome(invite.id);
    } catch { setMessage("Could not connect. Retry the invitation action to check its result."); }
    finally { inFlight.current = false; setBusy(""); onPending(false); }
  }
  return <><p>Accept an invitation to view and edit the whole sheet.</p>{loading && invites === null && <LoadingState />}{error && <><Notice tone="error">{error}</Notice><Button onClick={retry} disabled={Boolean(busy) || opening}>Retry invitations</Button></>}{message && <Notice tone="error">{message}</Notice>}<div ref={resultFocus}>{outcomes.map(({ invite, kind }) => <div className="sharing-outcome" key={invite.id}><p role="status" tabIndex={kind === "declined" ? -1 : undefined} data-invite-result={kind === "declined" ? invite.id : undefined}>{kind === "accepted" ? `Invitation accepted. You now share ${invite.sheetName}.` : `Invitation to ${invite.sheetName} declined.`}</p>{kind === "accepted" && <Button data-invite-result={invite.id} variant="primary" pending={opening} disabled={Boolean(busy) || opening} onClick={() => onOpenSheet(invite.sheetId)}>Open sheet <span className="sr-only">{invite.sheetName}</span></Button>}</div>)}</div>{invites?.filter((invite) => !outcomes.some((outcome) => outcome.invite.id === invite.id)).map((invite) => <div className="sharing-invite" key={invite.id}><strong>{invite.sheetName}</strong><p className="hint">{invite.inviterName}{invite.inviterUsername ? ` @${invite.inviterUsername}` : ""} invited you to share this sheet.</p><div className="actions"><Button disabled={Boolean(busy) || opening} pending={busy === `${invite.id}:decline`} onClick={() => void respond(invite, "decline")}>Decline <span className="sr-only">{invite.sheetName}</span></Button><Button variant="primary" disabled={Boolean(busy) || opening} pending={busy === `${invite.id}:accept`} onClick={() => void respond(invite, "accept")}>Accept <span className="sr-only">{invite.sheetName}</span></Button></div></div>)}{invites?.length === 0 && !loading && !error && <p>No pending invitations.</p>}</>;
}
