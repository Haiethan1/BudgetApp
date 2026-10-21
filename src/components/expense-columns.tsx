"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { defaultGridLayout, gridColumns, gridLayoutKey, gridLayoutSchema, type GridLayout, type PersonColumn } from "../ledger/grid-layout";
import { Button } from "./ui";
import { Dialog } from "./dialog";

const memory = new Map<string, string>();
const changed = "homebooks-expense-columns-changed";
const empty = JSON.stringify(defaultGridLayout);
function subscribe(notify: () => void) { window.addEventListener("storage", notify); window.addEventListener(changed, notify); return () => { window.removeEventListener("storage", notify); window.removeEventListener(changed, notify); }; }
export function useExpenseColumns(userId: string, sheetId: string) {
  const key = gridLayoutKey(userId, sheetId);
  const read = useCallback(() => { try { return localStorage.getItem(key) ?? memory.get(key) ?? empty; } catch { return memory.get(key) ?? empty; } }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => empty);
  const layout = useMemo(() => { try { const parsed = gridLayoutSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : defaultGridLayout; } catch { return defaultGridLayout; } }, [raw]);
  function save(next: GridLayout) { const raw = JSON.stringify(next); memory.set(key, raw); try { localStorage.setItem(key, raw); } catch { /* Layout preferences remain available in this tab. */ } window.dispatchEvent(new Event(changed)); }
  return { layout, save };
}
export function ExpenseColumns({ people, layout, onChange, onClose }: { people: PersonColumn[]; layout: GridLayout; onChange: (layout: GridLayout) => void; onClose: () => void }) {
  const visible = gridColumns(people, layout);
  function move(id: string, step: number) {
    const order = visible.map(person => person.id), index = order.indexOf(id), target = index + step;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    onChange({ ...layout, order });
  }
  return <Dialog title="Expense columns" open onClose={onClose}><p>Choose your layout for this sheet. Hidden shares still count in totals.</p>
    <div className="expense-column-choices">{people.map(person => <label className="checkbox-row" key={person.id}><input type="checkbox" checked={visible.some(column => column.id === person.id)} onChange={event => onChange(event.target.checked ? { ...layout, order: [...new Set([...layout.order, ...visible.map(column => column.id), person.id])], hidden: layout.hidden.filter(id => id !== person.id) } : { ...layout, hidden: [...new Set([...layout.hidden, person.id])] })} />{person.name}{person.isArchived ? " (archived)" : ""}</label>)}</div>
    <h3>Visible column order</h3>{visible.map((person, index) => <div className="expense-column-order" key={person.id}><span>{person.name}</span><Button disabled={index === 0} aria-label={`Move ${person.name} earlier`} onClick={() => move(person.id, -1)}>↑</Button><Button disabled={index === visible.length - 1} aria-label={`Move ${person.name} later`} onClick={() => move(person.id, 1)}>↓</Button></div>)}
    <label className="checkbox-row"><input type="checkbox" checked={layout.date} onChange={event => onChange({ ...layout, date: event.target.checked })} />Show date</label><label className="checkbox-row"><input type="checkbox" checked={layout.account} onChange={event => onChange({ ...layout, account: event.target.checked })} />Show account</label>
    <Button onClick={() => onChange(defaultGridLayout)}>Reset layout</Button>
  </Dialog>;
}
