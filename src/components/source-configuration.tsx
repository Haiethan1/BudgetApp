import type { ReactNode } from "react";
import { Button } from "./ui";

export function SourceConfiguration({ mode, pending, name, onEdit, onInspect, children }: {
  mode: "new" | "collapsed" | "locked" | "editing"; pending: boolean; name: string;
  onEdit: () => void; onInspect: () => void; children: ReactNode;
}) {
  const locked = mode === "collapsed" || mode === "locked";
  return <>
    {mode !== "new" && <><p className="hint">{name} · {locked ? "Saved CSV format settings are locked." : "Editing settings for this import. Update the saved CSV format explicitly to reuse these changes."}</p>
      <div className="actions import-actions">{locked && <Button disabled={pending} onClick={onEdit}>Edit CSV format</Button>}{mode !== "editing" && <Button disabled={pending} aria-expanded={mode === "locked"} onClick={onInspect}>{mode === "locked" ? "Hide CSV format settings" : "View CSV format settings"}</Button>}</div></>}
    {mode !== "collapsed" && <fieldset className="editor-fields" disabled={pending || locked}>{children}</fieldset>}
  </>;
}
