import { z } from "zod";
import { monthSchema } from "../ledger/input";

export const cycleStartDaySchema = z.number().int().min(1).max(31);
export const cycleSchema = z.object({ startDay: cycleStartDaySchema, version: z.number().int().positive(), from: z.string(), to: z.string() });
function days(year: number, month: number) { return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31; }
function date(year: number, month: number, day: number) { return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
export function budgetCycle(month: string, startDay = 1, version = 1) {
  const valid = monthSchema.parse(month); cycleStartDaySchema.parse(startDay);
  const year = Number(valid.slice(0, 4)); const number = Number(valid.slice(5));
  const nextMonth = number === 12 ? 1 : number + 1; const nextYear = number === 12 ? year + 1 : year;
  const nextStart = Math.min(startDay, days(nextYear, nextMonth));
  const to = valid === "9999-12" ? "9999-12-31" : nextStart === 1 ? date(year, number, days(year, number)) : date(nextYear, nextMonth, nextStart - 1);
  return { startDay, version, from: date(year, number, Math.min(startDay, days(year, number))), to };
}
export function currentCycleMonth(startDay = 1, now = new Date()) {
  const month = date(now.getFullYear(), now.getMonth() + 1, 1).slice(0, 7);
  if (now.getDate() >= Math.min(startDay, days(now.getFullYear(), now.getMonth() + 1))) return month;
  const previous = now.getMonth() === 0 ? date(now.getFullYear() - 1, 12, 1).slice(0, 7) : date(now.getFullYear(), now.getMonth(), 1).slice(0, 7);
  return previous < "1000-01" ? "1000-01" : previous;
}
export function cycleRangeLabel(cycle: Pick<z.infer<typeof cycleSchema>, "from" | "to">) {
  const format = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return `${format(cycle.from)} through ${format(cycle.to)}. Both dates included`;
}
