"use client";
import { useTransition } from "react";
import { Button, Panel } from "../../../components/ui";

export default function SheetLoadError({ retry }: { retry: () => void }) {
  const [pending, startTransition] = useTransition();
  return <Panel><h2>Could not load this page</h2>
    <p role="alert">Try loading it again.</p><Button pending={pending} onClick={() => startTransition(retry)}>Retry</Button>
    <span className="sr-only" role="status">{pending ? "Retrying page" : ""}</span>
  </Panel>;
}
