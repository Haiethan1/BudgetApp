"use client";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "./ui";

export type CloseDecision = "blocked" | "confirm" | "close";
export function closeDecision(pending: boolean, dirty: boolean): CloseDecision { return pending ? "blocked" : dirty ? "confirm" : "close"; }

export function Dialog({ title, open, onClose, children, drawer = false, dirty = false, pending = false, returnFocus }: {
  title: string; open: boolean; onClose: () => void; children: ReactNode; drawer?: boolean; dirty?: boolean; pending?: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const editingFocus = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    trigger.current = returnFocus?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.showModal();
    return () => { dialog.close(); trigger.current?.focus(); };
  }, [open, returnFocus]);
  function requestClose() {
    switch (closeDecision(pending, dirty)) {
      case "blocked": return;
      case "confirm": editingFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setConfirming(true); return;
      case "close": onClose();
    }
  }
  function keepEditing() { setConfirming(false); requestAnimationFrame(() => editingFocus.current?.focus()); }
  return <dialog ref={ref} aria-labelledby={titleId} aria-busy={pending} className={`dialog${drawer ? " drawer" : ""}`} onCancel={(event) => { event.preventDefault(); if (confirming) keepEditing(); else requestClose(); }}>
    <header className="dialog-header"><h2 id={titleId}>{confirming ? "Discard changes?" : title}</h2><Button disabled={pending} onClick={requestClose}>Close</Button></header>
    <div className="dialog-body"><div hidden={confirming}>{children}</div>{confirming && <><p>Your unsaved entries will be discarded.</p><div className="actions"><Button autoFocus onClick={keepEditing}>Keep editing</Button><Button variant="danger" onClick={() => { setConfirming(false); onClose(); }}>Discard changes</Button></div></>}</div>
  </dialog>;
}
