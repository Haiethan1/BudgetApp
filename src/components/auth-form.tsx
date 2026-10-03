"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { identitySchema, passwordRule } from "@/auth/identity";
import { Button, Field, Notice } from "./ui";

const replySchema = z.object({ message: z.string().optional() });
type Mode = "setup" | "sign-in" | "register";

export function AuthForm({ mode, expired = false }: { mode: Mode; expired?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const title = mode === "setup" ? "Set up Homebooks" : mode === "register" ? "Create account" : "Sign in";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setMessage("");
    setErrors({});
    const parsed = mode === "sign-in" ? z.object({ identifier: z.string().trim().min(1, "Enter your email or username."),
      password: z.string().min(1, "Enter your password.") }).safeParse(data) : identitySchema.safeParse(data);
    const clearSecrets = () => {
      for (const name of ["password", "setupToken"]) {
        const control = form.elements.namedItem(name);
        if (control instanceof HTMLInputElement) control.value = "";
      }
    };
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      setMessage("Check the highlighted fields.");
      clearSecrets();
      return;
    }
    setPending(true);
    try {
      let endpoint: string;
      let body: unknown;
      if (mode === "sign-in") {
        const identifier = String(data.identifier).trim();
        endpoint = identifier.includes("@") ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username";
        body = identifier.includes("@") ? { email: identifier, password: data.password } : { username: identifier, password: data.password };
      } else {
        endpoint = mode === "setup" ? "/api/setup" : "/api/auth/sign-up/email";
        body = { ...parsed.data, ...(mode === "setup" ? { setupToken: data.setupToken } : {}) };
      }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        const reply = replySchema.safeParse(await response.json());
        setMessage(reply.success && reply.data.message ? reply.data.message : "The request could not finish. Try again.");
        clearSecrets();
        return;
      }
      clearSecrets();
      router.push(mode === "sign-in" ? "/" : `/sign-in?${mode === "setup" ? "setup" : "registered"}=1`);
      router.refresh();
    } catch {
      setMessage("Could not connect. Check your connection and try again.");
      clearSecrets();
    } finally {
      setPending(false);
    }
  }

  function field(name: string, label: string, type = "text", autocomplete = "") {
    return <Field label={label} id={name} name={name} type={type} autoComplete={autocomplete} required error={errors[name]}
      aria-describedby={name === "password" && mode !== "sign-in" ? "password-hint" : undefined} />;
  }

  return <form onSubmit={submit} noValidate={mode !== "setup"} aria-busy={pending}>
    <h1>{title}</h1>
    {mode === "setup" && <p>This account becomes the instance admin. Admin status does not grant access to other people&apos;s sheets.</p>}
    {expired && <p role="status">Your session expired. Sign in again to continue.</p>}
    {message && <Notice tone="error">{message}</Notice>}
    {mode !== "sign-in" && <>{field("name", "Display name", "text", "name")}{field("username", "Username", "text", "username")}
      <p className="hint">Use 3 to 30 letters, numbers, underscores, or periods.</p>{field("email", "Email", "email", "email")}</>}
    {mode === "sign-in" && field("identifier", "Email or username", "text", "username")}
    {mode !== "sign-in" && <p className="hint" id="password-hint">{passwordRule}</p>}
    {field("password", "Password", showPassword ? "text" : "password", mode === "sign-in" ? "current-password" : "new-password")}
    <label className="check"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show password</label>
    {mode === "setup" && field("setupToken", "One-time setup token", "password", "off")}
    <Button variant="primary" pending={pending} type="submit">{title}</Button>
    {mode === "sign-in" && <p className="hint">For password recovery, ask the host admin to run the documented recovery command.</p>}
  </form>;
}
