"use client";
import { currentCycleMonth } from "../sheets/cycle";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "./ui";
import { currentMonth, monthLabel } from "./shell-state";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Chevron({ next = false }: { next?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={next ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} /></svg>;
}

export function MonthPicker({ month, onChange, startDay = 1 }: { month: string; startDay?: number; onChange: (month: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [pending, startTransition] = useTransition();
  const id = useId();
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && disclosure.current) disclosure.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  function choose(value: string) {
    if (disclosure.current) disclosure.current.open = false;
    trigger.current?.focus();
    if (value !== month) startTransition(() => onChange(value));
  }
  function step(offset: number) {
    choose(currentMonth(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + offset, 1)));
  }
  return <div className="month-picker" ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && disclosure.current?.open) {
      event.preventDefault(); disclosure.current.open = false; trigger.current?.focus();
    }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget) && disclosure.current) disclosure.current.open = false;
  }}>
    <span className="month-picker-label" id={`${id}-label`}>Selected month</span>
    <div className="month-controls" aria-busy={pending}>
      <Button className="month-step" aria-label="Previous month" disabled={pending || month === "1000-01"} onClick={() => step(-1)}><Chevron /></Button>
      <details ref={disclosure} onToggle={(event) => { if (event.currentTarget.open) setYear(Number(month.slice(0, 4))); }}>
        <summary ref={trigger} id="selected-month" className="month-trigger" aria-labelledby={`${id}-label ${id}-value`} onClick={(event) => { if (pending) event.preventDefault(); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
          <span id={`${id}-value`}>{monthLabel(month)}</span><span className="month-caret" aria-hidden="true">⌄</span>
        </summary>
        <div className="month-panel" role="group" aria-label="Choose month">
          <div className="month-year"><Button aria-label="Previous year" disabled={year === 1000} onClick={() => setYear(year - 1)}><Chevron /></Button><strong aria-live="polite">{year}</strong><Button aria-label="Next year" disabled={year === 9999} onClick={() => setYear(year + 1)}><Chevron next /></Button></div>
          <div className="month-grid">{months.map((label, index) => {
            const value = `${year}-${String(index + 1).padStart(2, "0")}`;
            return <Button key={label} className="month-choice" aria-label={monthLabel(value)} aria-pressed={value === month} disabled={pending} onClick={() => choose(value)}>{label}</Button>;
          })}</div>
          <Button className="month-current" disabled={pending} onClick={() => choose(currentCycleMonth(startDay))}>Current month</Button>
        </div>
      </details>
      <Button className="month-step" aria-label="Next month" disabled={pending || month === "9999-12"} onClick={() => step(1)}><Chevron next /></Button>
    </div>
    <span className="sr-only" role="status">{pending ? "Loading selected month" : ""}</span>
  </div>;
}
