import type { ReactNode } from "react";
import { Button } from "./ui";

export function SourceConfiguration({ mode, pending, name, onEdit, onInspect, children }: {
  mode: "new" | "collapsed" | "locked" | "editing"; pending: boolean; name: string;
  onEdit: () => void; onInspect: () => void; children: ReactNode;
}) {
  const locked = mode === "collapsed" || mode === "locked";
  return <>
    {mode !== "new" && <><p className="hint">{name} · {locked ? "Saved CSV import format settings are locked." : "Editing CSV import format settings. Save CSV import format to keep these changes."}</p>
      <div className="actions import-actions">{locked && <Button disabled={pending} onClick={onEdit}>Edit CSV import format</Button>}{mode !== "editing" && <Button disabled={pending} aria-expanded={mode === "locked"} onClick={onInspect}>{mode === "locked" ? "Hide CSV import format settings" : "View CSV import format settings"}</Button>}</div></>}
    {mode !== "collapsed" && <fieldset className="editor-fields" disabled={pending || locked}>{children}</fieldset>}
  </>;
}
