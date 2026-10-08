"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { settingsMutation, displayNameSchema, sourceTypes, type organizationKind } from "@/sheets/settings-input";
import { Badge, Button, Field, Notice, Panel, Selector } from "./ui";
import { Dialog } from "./dialog";
import { PeopleSettings } from "./people-settings";
import { sheetFailure } from "./sheet-access";

type Sheet = ReturnType<typeof readSheet>;
type Entity = z.infer<typeof organizationKind>;
type Editor = { kind: "create"; entity: Entity } | { kind: "rename"; entity: Entity; id: string; name: string } | { kind: "archive" | "restore"; entity: Entity; id: string; name: string } | { kind: "renameSheet" | "deleteSheet" | "profile"; name: string };
export function SettingsScreen({ sheet, profile }: { sheet: Sheet; profile: { name: string; username?: string | null; email: string } }) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState("bank");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [success, setSuccess] = useState("");
  const inFlight = useRef(false);
  function open(next: Editor) { setEditor(next); setName(next.kind === "create" || next.kind === "deleteSheet" ? "" : next.name); setSourceType("bank"); setMessage(""); setFieldError(""); }
  function entitySection(entity: Entity, title: string, records: { id: string; name: string; isArchived: boolean; isProtected?: boolean; sourceType?: keyof typeof sourceTypes }[]) {
    return <Panel><h2>{title}</h2>{entity === "account" && <p className="hint">Sources for transactions. No bank credentials or balances.</p>}{records.length === 0 && <p>No financial accounts yet. Add an account before entering transactions.</p>}{records.map((record) => <div className="setting-row" key={record.id}><div><strong>{record.name}</strong>{record.sourceType && <p className="hint">{sourceTypes[record.sourceType]}</p>}<Badge>{record.isProtected ? "Protected default" : record.isArchived ? "Archived" : "Active"}</Badge></div>{!record.isProtected && <div className="actions"><Button onClick={() => open({ kind: "rename", entity, id: record.id, name: record.name })}>Rename</Button><Button onClick={() => open({ kind: record.isArchived ? "restore" : "archive", entity, id: record.id, name: record.name })}>{record.isArchived ? "Restore" : "Archive"}</Button></div>}</div>)}<Button onClick={() => open({ kind: "create", entity })}>Add {entity === "account" ? "financial account" : entity === "category" ? "category" : "attribution bucket"}</Button></Panel>;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!editor || inFlight.current) return;
    const input = editor.kind === "profile" ? { name } : editor.kind === "create" ? { ...editor, name, sourceType } : editor.kind === "rename" || editor.kind === "renameSheet" ? { ...editor, name } : editor.kind === "deleteSheet" ? { kind: editor.kind, confirmation: name } : editor;
    const parsed = editor.kind === "profile" ? displayNameSchema.safeParse(input) : settingsMutation.safeParse(input);
    setMessage(""); setFieldError("");
    if (!parsed.success) { setFieldError(parsed.error.issues[0]?.message ?? "Check the name."); return; }
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(editor.kind === "profile" ? "/api/profile" : `/api/sheets/${sheet.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (await sheetFailure(response, sheet.id)) return;
      const reply = z.object({ message: z.string(), fields: z.record(z.string(), z.array(z.string()).optional()).optional() }).safeParse(await response.json());
      if (!response.ok) { setMessage(reply.success ? reply.data.message : "Could not save. Try again."); if (response.status === 409) setFieldError(reply.success ? reply.data.message : "Choose another name."); return; }
      setSuccess(editor.kind === "profile" ? "Display name saved." : "Changes saved."); setEditor(null);
      if (editor.kind === "deleteSheet") router.replace("/");
      router.refresh();
    } catch { setMessage("Could not connect. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const title = editor ? editor.kind === "create" ? `Add ${editor.entity === "account" ? "financial account" : editor.entity === "category" ? "category" : "attribution bucket"}` : editor.kind === "profile" ? "Edit display name" : editor.kind === "renameSheet" ? "Rename sheet" : editor.kind === "deleteSheet" ? "Delete sheet" : `${editor.kind === "rename" ? "Rename" : editor.kind === "archive" ? "Archive" : "Restore"} ${editor.name}` : "";
  const nameForm = editor && !["archive", "restore"].includes(editor.kind);
  const initialName = editor && editor.kind !== "create" && editor.kind !== "deleteSheet" ? editor.name : "";
  return <>{success && <Notice>{success}</Notice>}<Panel><h2>Sheet</h2><div className="setting-row"><div><strong>{sheet.name}</strong><p className="hint">{sheet.currency} · Set at creation · You are the {sheet.role}</p></div>{sheet.role === "owner" && <Button onClick={() => open({ kind: "renameSheet", name: sheet.name })}>Rename sheet</Button>}</div>{sheet.role === "owner" ? <div className="setting-row"><p className="hint">Deleting this sheet removes its records for everyone.</p><Button variant="danger" onClick={() => open({ kind: "deleteSheet", name: sheet.name })}>Delete sheet</Button></div> : <p className="hint">You can leave this shared sheet in People below.</p>}</Panel>{entitySection("account", "Financial accounts", sheet.accounts)}{entitySection("category", "Categories", sheet.categories)}{entitySection("bucket", "Attribution buckets", sheet.buckets)}<PeopleSettings sheet={sheet} /><Panel><h2>Your profile</h2><div className="setting-row"><div><strong>{profile.name}</strong><p className="hint">@{profile.username} · {profile.email}</p></div><Button onClick={() => open({ kind: "profile", name: profile.name })}>Edit display name</Button></div><p className="hint">Your display name applies across sheets. Sign out is in the navigation.</p></Panel>{editor && <Dialog open title={title} onClose={() => setEditor(null)} pending={pending} dirty={name !== initialName || sourceType !== "bank"}><form onSubmit={submit} noValidate aria-busy={pending}>{message && <Notice tone="error">{message}</Notice>}{editor.kind === "deleteSheet" && <Notice tone="warning">This permanently removes {editor.name} and its records for everyone. Type the sheet name to confirm.</Notice>}{editor.kind === "archive" && <p>History keeps this item. It will be unavailable for new transactions and allocations.</p>}{editor.kind === "restore" && <p>This item will be available for new transactions and allocations again.</p>}{nameForm && <Field autoFocus label={editor.kind === "deleteSheet" ? "Type sheet name" : editor.kind === "profile" ? "Display name" : "Name"} id="settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} error={fieldError} disabled={pending} />}{editor.kind === "create" && editor.entity === "account" && <Selector label="Source type" id="settings-source" value={sourceType} onChange={(event) => setSourceType(event.target.value)} disabled={pending}>{Object.entries(sourceTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Selector>}<div className="actions"><Button type="submit" variant={editor.kind === "deleteSheet" ? "danger" : "primary"} pending={pending}>{editor.kind === "deleteSheet" ? "Delete sheet" : editor.kind === "archive" ? "Archive" : editor.kind === "restore" ? "Restore" : "Save"}</Button></div></form></Dialog>}</>;
}
