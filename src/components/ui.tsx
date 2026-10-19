import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
export { Help } from "./help";

export function Button({ variant = "secondary", pending = false, children, className = "", disabled, type = "button", ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger"; pending?: boolean }) {
  return <button {...props} type={type} className={`button ${variant} ${className}`} disabled={disabled || pending} aria-busy={pending || undefined}>{children}{pending && <span aria-hidden="true" className="spinner" />}</button>;
}
export function Field({ label, labelHelp, error, hint, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; labelHelp?: ReactNode; error?: string; hint?: string }) {
  const described = [props["aria-describedby"], error ? `${id}-error` : undefined, hint ? `${id}-hint` : undefined].filter(Boolean).join(" ");
  return <div className="field"><div className="help-label"><label htmlFor={id}>{label}</label>{labelHelp}</div><input {...props} id={id} aria-invalid={Boolean(error)} aria-describedby={described || undefined} />{hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}{error && <p className="field-error" id={`${id}-error`}>{error}</p>}</div>;
}
export function Selector({ label, labelHelp, hint, error, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; labelHelp?: ReactNode; hint?: string; error?: string }) {
  const described = [props["aria-describedby"], error ? `${id}-error` : undefined, hint ? `${id}-hint` : undefined].filter(Boolean).join(" ");
  return <div className="field"><div className="help-label"><label htmlFor={id}>{label}</label>{labelHelp}</div><select {...props} id={id} aria-invalid={Boolean(error)} aria-describedby={described || undefined}>{children}</select>{hint && <p id={`${id}-hint`} className="hint">{hint}</p>}{error && <p id={`${id}-error`} className="field-error">{error}</p>}</div>;
}
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`shared-panel ${className}`}>{children}</section>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "danger" }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "error" }) { return <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>; }
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <Panel><h2>{title}</h2><p>{children}</p>{action}</Panel>; }
export function ErrorState({ children, retry }: { children: ReactNode; retry?: () => void }) { return <Panel><Notice tone="error">{children}</Notice>{retry && <Button onClick={retry}>Retry</Button>}</Panel>; }
export function LoadingState() { return <div role="status" aria-busy="true"><span className="sr-only">Loading Homebooks</span><div className="skeleton" /><div className="skeleton" /></div>; }
export function BudgetBar({ spent, limit, label }: { spent: number; limit: number; label: string }) {
  const percentage = limit > 0 ? Math.max(0, Math.min(100, spent / limit * 100)) : spent > 0 ? 100 : 0;
  return <div className="budget-track" role="img" aria-label={label}><div className={`budget-fill${spent > limit ? " over" : ""}`} style={{ width: `${percentage}%` }} /></div>;
}
export function ResponsiveRecords({ headers, rows, cards, onActivate }: { headers: string[]; rows: ReactNode[][]; cards: ReactNode[]; onActivate?: (index: number) => void }) {
  return <><div className="records-table"><table><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} onClick={onActivate ? () => onActivate(index) : undefined}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div><div className="records-cards">{cards.map((card, index) => <article className="record-card" key={index}>{card}</article>)}</div></>;
}
