import type { ReactNode } from "react";
import { Button } from "./ui";

export function SourceConfiguration({ mode, pending, name, onEdit, onInspect, children }: {
  mode: "new" | "collapsed" | "locked" | "editing"; pending: boolean; name: string;
  onEdit: () => void; onInspect: () => void; children: ReactNode;
}) {
  const locked = mode === "collapsed" || mode === "locked";
  return <>
    {mode !== "new" && <><p className="hint">{name} · {locked ? "Saved source settings are locked." : "Editing source settings. Save mapping to update the saved profile."}</p>
      <div className="actions import-actions">{locked && <Button disabled={pending} onClick={onEdit}>Edit source</Button>}{mode !== "editing" && <Button disabled={pending} aria-expanded={mode === "locked"} onClick={onInspect}>{mode === "locked" ? "Hide source settings" : "View source settings"}</Button>}</div></>}
    {mode !== "collapsed" && <fieldset className="editor-fields" disabled={pending || locked}>{children}</fieldset>}
  </>;
}
