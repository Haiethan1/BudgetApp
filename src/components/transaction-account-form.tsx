"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { organizationName, sourceTypes } from "../sheets/settings-input";
import { Button, Field, Notice, Selector } from "./ui";

export function TransactionAccountForm({ sheetId, id, onAdded, onUnavailable, onDirty, onPending }: {
  sheetId: string; id: string; onAdded: (name: string) => Promise<void>; onUnavailable: (status: number) => void;
  onDirty: (dirty: boolean) => void; onPending: (pending: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState("bank");
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    const parsed = organizationName.safeParse(name);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Enter an account name."); return; }
    inFlight.current = true; setPending(true); onPending(true); setError("");
    let saved = created;
    try {
      if (!created) {
        const response = await fetch(`/api/sheets/${sheetId}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "create", entity: "account", name: parsed.data, sourceType }) });
        if (response.status === 401 || response.status === 404) { onUnavailable(response.status); return; }
        if (!response.ok) { const reply = z.object({ message: z.string() }).safeParse(await response.json()); setError(reply.success ? reply.data.message : "Could not add this account. Try again."); return; }
        setCreated(true); saved = true;
      }
      await onAdded(parsed.data);
      onDirty(false);
    } catch { setError(saved ? "Account saved. Retry loading it to continue." : "Could not connect. Your account choices are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); onPending(false); }
  }
  return <form onSubmit={submit} noValidate aria-busy={pending}>{error && <Notice tone="error">{error}</Notice>}
    <Field autoFocus id={`${id}-name`} label="Transaction account name" required maxLength={80} value={name} disabled={pending || created} onChange={event => { setName(event.target.value); onDirty(Boolean(event.target.value) || sourceType !== "bank"); }} />
    <Selector id={`${id}-source`} label="Source type" value={sourceType} disabled={pending || created} onChange={event => { setSourceType(event.target.value); onDirty(Boolean(name) || event.target.value !== "bank"); }}>{Object.entries(sourceTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Selector>
    <Button type="submit" variant="primary" pending={pending}>{created ? "Retry loading account" : "Add account and continue"}</Button>
  </form>;
}
