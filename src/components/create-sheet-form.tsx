"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createSheetSchema } from "@/sheets/input";

export function CreateSheetForm({ currencies }: { currencies: string[] }) {
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
    inFlight.current = true; setPending(true);
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
    finally { inFlight.current = false; setPending(false); }
  }
  return <form onSubmit={submit} noValidate aria-busy={pending}>
    {message && <p className="notice error" role="alert">{message}</p>}
    <div className="field"><label htmlFor="sheet-name">Sheet name</label><input id="sheet-name" value={name} onChange={(event) => setName(event.target.value)}
      required maxLength={80} autoComplete="off" aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? "sheet-name-error" : undefined} />
      {fields.name && <p id="sheet-name-error" className="field-error">{fields.name[0]}</p>}</div>
    <div className="field"><label htmlFor="sheet-currency">Currency</label><select id="sheet-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}
      aria-describedby="currency-hint">{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <p className="hint" id="currency-hint">Currency cannot change after transactions exist.</p></div>
    <p className="hint">You will own this sheet. It starts with Uncategorized and Unassigned defaults.</p>
    <button className="button primary" disabled={pending} type="submit">Create sheet{pending ? "…" : ""}</button>
  </form>;
}
