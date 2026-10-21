"use client";
import { useEffect, useRef, useState } from "react";
import { IntentLink } from "./intent-link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { settingsMutation, displayNameSchema, sourceTypes, type organizationKind } from "@/sheets/settings-input";
import { Badge, Button, Field, Notice, Panel, Selector, Help } from "./ui";
import type { readBudgets } from "@/budgets/service";
import type { sharingPageSchema } from "@/sharing/presentation";
import { BudgetsScreen } from "./budgets-screen";
import { currentPeriod } from "../sheets/cycle";
import { BudgetCycleSettings } from "./budget-cycle-settings";
import { Dialog } from "./dialog";

import { ExportSheet } from "./export-sheet";
import { PeopleSettings } from "./people-settings";
import { sheetFailure } from "./sheet-access";

type Sheet = ReturnType<typeof readSheet>;
type Entity = z.infer<typeof organizationKind>;
type Editor = { kind: "create"; entity: Entity } | { kind: "rename"; entity: Entity; id: string; name: string } | { kind: "archive" | "restore"; entity: Entity; id: string; name: string } | { kind: "renameSheet" | "deleteSheet" | "profile"; name: string };
export function SettingsScreen({ sheet, profile, initialBudgets, initialPeople }: { initialBudgets?: ReturnType<typeof readBudgets>; initialPeople?: z.infer<typeof sharingPageSchema>; sheet: Sheet; profile: { name: string; username?: string | null; email: string } }) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState("bank");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [success, setSuccess] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    function reveal(hash = window.location.hash) {
      if (!hash) return;
      let id: string; try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
      const target = document.getElementById(id); if (!target) return;
      let parent: HTMLElement | null = target;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    }
    function changed() { reveal(); }
    function clicked(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]"); if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href); if (url.pathname === window.location.pathname && url.hash) reveal(url.hash);
    }
    reveal(); window.addEventListener("hashchange", changed); document.addEventListener("click", clicked, true);
    return () => { window.removeEventListener("hashchange", changed); document.removeEventListener("click", clicked, true); };
  }, []);
  const categoryRevision = JSON.stringify(sheet.categories.map(({ id, name, isArchived }) => ({ id, name, isArchived })));
  function open(next: Editor) { setEditor(next); setName(next.kind === "create" || next.kind === "deleteSheet" ? "" : next.name); setSourceType("bank"); setMessage(""); setFieldError(""); }
  function entitySection(entity: Entity, title: string, records: { id: string; name: string; isArchived: boolean; isProtected?: boolean; sourceType?: keyof typeof sourceTypes }[]) {
    return <div id={entity === "account" ? "transaction-accounts" : entity === "category" ? "spending-categories" : "spending-groups"}><Panel><div className="help-label"><h2>{title}</h2><Help label={title}><p>{entity === "account" ? "Choose the source of your transactions: checking, credit card, or cash." : entity === "category" ? "Categories describe what you spent on. Set their limits in Budgets." : "Choose the people responsible for each expense. For a lunch you covered for your parents, assign their share to Parents. These names do not grant sheet access. Enable repayment tracking separately in Repayments."}</p></Help></div>{records.length === 0 && <p>Add an account to start entering transactions.</p>}{records.map((record) => <div className="setting-row" key={record.id}><div><div className="setting-identity"><strong>{record.name}</strong><Badge>{record.isProtected ? "Protected default" : record.isArchived ? "Archived" : "Active"}</Badge></div>{record.sourceType && <p className="hint">{sourceTypes[record.sourceType]}</p>}</div>{!record.isProtected && <div className="actions"><Button onClick={() => open({ kind: "rename", entity, id: record.id, name: record.name })}>Rename</Button><Button onClick={() => open({ kind: record.isArchived ? "restore" : "archive", entity, id: record.id, name: record.name })}>{record.isArchived ? "Restore" : "Archive"}</Button></div>}</div>)}<Button onClick={() => open({ kind: "create", entity })}>Add {entity === "account" ? "transaction account" : entity === "category" ? "spending category" : "person or group"}</Button></Panel></div>;
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
  const title = editor ? editor.kind === "create" ? `Add ${editor.entity === "account" ? "transaction account" : editor.entity === "category" ? "spending category" : "person or group"}` : editor.kind === "profile" ? "Edit display name" : editor.kind === "renameSheet" ? "Rename sheet" : editor.kind === "deleteSheet" ? "Delete sheet" : `${editor.kind === "rename" ? "Rename" : editor.kind === "archive" ? "Archive" : "Restore"} ${editor.name}` : "";
  const nameForm = editor && !["archive", "restore"].includes(editor.kind);
  const initialName = editor && editor.kind !== "create" && editor.kind !== "deleteSheet" ? editor.name : "";
  return <>{success && <Notice>{success}</Notice>}<Panel><h2>Sheet</h2><div className="setting-row"><div><strong>{sheet.name}</strong><p className="hint">{sheet.currency} · Set at creation · You are the {sheet.role}</p></div>{sheet.role === "owner" && <Button onClick={() => open({ kind: "renameSheet", name: sheet.name })}>Rename sheet</Button>}</div>{sheet.role === "owner" ? <div className="setting-row"><p className="hint">Deleting this sheet removes its records for everyone.</p><Button variant="danger" onClick={() => open({ kind: "deleteSheet", name: sheet.name })}>Delete sheet</Button></div> : <p className="hint">You can leave this shared sheet in Sharing below.</p>}</Panel><ExportSheet key={sheet.id} sheetId={sheet.id} /><BudgetCycleSettings sheet={sheet} />{entitySection("account", "Transaction accounts", sheet.accounts)}{entitySection("bucket", "Expense people", sheet.buckets)}<details className="settings-optional" id="optional-tools"><summary>Optional tools · budgets, payment plans and categories</summary><span id="sheet-setup" /><Panel><h2>Optional tools</h2><p>Use these when you want category limits or future-payment planning. Expenses and repayments work without them.</p><div className="actions"><IntentLink className="button secondary" href="/overview">Spending overview</IntentLink><IntentLink className="button secondary" href="/budgets">Budgets</IntentLink><IntentLink className="button secondary" href="/budgets#upcoming-payments">Payment plans</IntentLink></div></Panel>{entitySection("category", "Spending categories", sheet.categories)}<div id="default-budgets"><Panel><h2>Default budgets</h2><BudgetsScreen initialResult={initialBudgets} sheet={sheet} month={currentPeriod(sheet)} defaults categoryRevision={categoryRevision} /></Panel></div></details><PeopleSettings initialData={initialPeople} sheet={sheet} /><Panel><h2>Your profile</h2><div className="setting-row"><div><strong>{profile.name}</strong><p className="hint">@{profile.username} · {profile.email}</p></div><Button onClick={() => open({ kind: "profile", name: profile.name })}>Edit display name</Button></div></Panel>{editor && <Dialog open title={title} onClose={() => setEditor(null)} pending={pending} dirty={name !== initialName || sourceType !== "bank"}><form onSubmit={submit} noValidate aria-busy={pending}>{message && <Notice tone="error">{message}</Notice>}{editor.kind === "deleteSheet" && <Notice tone="warning">This permanently removes {editor.name} and its records for everyone. Type the sheet name to confirm.</Notice>}{editor.kind === "archive" && <p>History keeps this item. It will be unavailable for new transactions and allocations.</p>}{editor.kind === "restore" && <p>This item will be available for new transactions and allocations again.</p>}{nameForm && <Field autoFocus label={editor.kind === "deleteSheet" ? "Type sheet name" : editor.kind === "profile" ? "Display name" : "Name"} id="settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} error={fieldError} disabled={pending} />}{editor.kind === "create" && editor.entity === "account" && <Selector label="Source type" id="settings-source" value={sourceType} onChange={(event) => setSourceType(event.target.value)} disabled={pending}>{Object.entries(sourceTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Selector>}<div className="actions"><Button type="submit" variant={editor.kind === "deleteSheet" ? "danger" : "primary"} pending={pending}>{editor.kind === "deleteSheet" ? "Delete sheet" : editor.kind === "archive" ? "Archive" : editor.kind === "restore" ? "Restore" : "Save"}</Button></div></form></Dialog>}</>;
}
