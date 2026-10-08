"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";
import { resetSheetAccess } from "./sheet-access";

export function SessionWatch() {
  const router = useRouter();
  useEffect(() => {
    async function check() {
      try {
        const response = await fetch("/api/auth/get-session", { cache: "no-store" });
        if (response.ok && await response.json() === null) {
          router.replace("/sign-in?expired=1");
          router.refresh();
        }
      } catch { /* Keep the current view during a transient connection failure. */ }
    }
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [router]);
  return null;
}

export function SignOut() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Sign-out failed.");
      resetSheetAccess();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("Could not sign out. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return <><Button pending={pending} onClick={signOut}>Sign out</Button>
    {error && <Notice tone="error">{error}</Notice>}</>;
}
