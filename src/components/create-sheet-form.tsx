"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createSheetSchema } from "@/sheets/input";
import { Button, Field, Notice, Selector } from "./ui";

export function CreateSheetForm({ currencies, onDirty, onPending }: { currencies: string[]; onDirty?: (dirty: boolean) => void; onPending?: (pending: boolean) => void }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setMessage(""); setFields({});
    const parsed = createSheetSchema.safeParse({ name, currency });
    if (!parsed.success) {
      setFields(z.flattenError(parsed.error).fieldErrors);
      setMessage("Check the highlighted fields.");
      return;
    }
    inFlight.current = true; setPending(true); onPending?.(true);
    try {
      const response = await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (response.status === 401) { router.replace("/sign-in?expired=1"); router.refresh(); return; }
      const reply = z.object({ id: z.uuid().optional(), message: z.string().optional() }).safeParse(await response.json());
      if (!response.ok || !reply.success || !reply.data.id) {
        setMessage(reply.success && reply.data.message ? reply.data.message : "Could not create the sheet. Try again.");
        return;
      }
      router.push(`/sheets/${reply.data.id}`); router.refresh();
    } catch { setMessage("Could not connect. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); onPending?.(false); }
  }
  return <form onSubmit={submit} noValidate aria-busy={pending}>
    {message && <Notice tone="error">{message}</Notice>}
    <Field label="Sheet name" id="sheet-name" value={name} onChange={(event) => { setName(event.target.value); onDirty?.(Boolean(event.target.value) || currency !== "USD"); }} required maxLength={80} autoComplete="off" error={fields.name?.[0]} />
    <Selector label="Currency" id="sheet-currency" value={currency} onChange={(event) => { setCurrency(event.target.value); onDirty?.(Boolean(name) || event.target.value !== "USD"); }} hint="Currency cannot change after transactions exist.">{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</Selector>
    <p className="hint">You will own this sheet. It starts with Uncategorized and Unassigned defaults.</p>
    <Button variant="primary" pending={pending} type="submit">Create sheet</Button>
  </form>;
}
