import { z } from "zod";
export const gridLayoutSchema = z.object({ version: z.literal(1), order: z.array(z.string()), hidden: z.array(z.string()), date: z.boolean(), account: z.boolean() });
export type GridLayout = z.infer<typeof gridLayoutSchema>;
export type PersonColumn = { id: string; name: string; isArchived: boolean; isProtected: boolean };
export const defaultGridLayout: GridLayout = { version: 1, order: [], hidden: [], date: false, account: false };
export function gridLayoutKey(userId: string, sheetId: string) { return `homebooks-expense-columns:v1:${userId}:${sheetId}`; }
export function gridColumns(people: PersonColumn[], layout: GridLayout) {
  const defaults = [...people.filter(person => person.isProtected), ...people.filter(person => !person.isProtected && !person.isArchived)];
  const order = [...new Set([...layout.order, ...defaults.map(person => person.id)])];
  return order.flatMap(id => { const person = people.find(person => person.id === id); return person && !layout.hidden.includes(person.id) ? [person] : []; });
}
