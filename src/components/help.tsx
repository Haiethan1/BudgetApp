"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { positionHelp } from "./help-position";

export function Help({ label, children, text }: { label: string; children: ReactNode; text?: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const cancelClose = useCallback(() => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = useCallback(() => { cancelClose(); pinned.current = false; setOpen(false); }, [cancelClose]);
  function show() { cancelClose(); setHost(trigger.current?.closest("dialog") ?? document.body); setOpen(true); }
  function leave() {
    cancelClose();
    timer.current = setTimeout(() => { if (!pinned.current && !popup.current?.matches(":hover") && document.activeElement !== trigger.current) setOpen(false); }, 160);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const panel = popup.current;
    const button = trigger.current;
    if (!open || !panel || !button) return;
    function position() {
      if (!panel || !button) return;
      const anchor = button.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      const { left, top, placement, arrow } = positionHelp({ anchor, popup: bounds, viewport: { width: window.innerWidth, height: window.innerHeight } });
      panel.dataset.placement = placement;
      panel.style.setProperty("--help-arrow-left", `${arrow}px`);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }
    panel.showPopover(); position();
    function outside(event: PointerEvent) { if (event.target instanceof Node && !panel?.contains(event.target) && !button?.contains(event.target)) close(); }
    function key(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      if (panel.matches(":popover-open")) panel.hidePopover();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, close]);
  return <span className={text ? "help-label" : "context-help"}>{text}<span className="context-help-anchor">
    <button ref={trigger} type="button" className="help-trigger" aria-label={`Help: ${label}`} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined} onPointerEnter={show} onPointerLeave={leave} onFocus={show} onBlur={leave} onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M8 7v4M8 4.5v.2" stroke="white" strokeWidth="1.7" strokeLinecap="round" /></svg></button>
    {open && host && createPortal(<div ref={popup} id={id} popover="manual" role="tooltip" className="help-popup" onPointerEnter={cancelClose} onPointerLeave={leave}><div className="help-popup-content">{children}</div></div>, host)}
  </span></span>;
}
