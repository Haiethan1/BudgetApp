import { z } from "zod";
import { dateSchema, monthSchema } from "../ledger/input";

export const cycleStartDaySchema = z.number().int().min(1).max(31);
export const revisionSchema = z.object({ transitionFrom: dateSchema, recurringFrom: dateSchema, startDay: cycleStartDaySchema });
export const historySchema = z.object({ baselineDay: cycleStartDaySchema, revisions: z.array(revisionSchema) });
export type CycleHistory = z.infer<typeof historySchema>;
export type CycleSheet = { cycleStartDay?: number; cycleVersion?: number; cycleHistory?: CycleHistory };
export const periodKeySchema = z.union([dateSchema, monthSchema]);
export const cycleSchema = z.object({ startDay: cycleStartDaySchema, version: z.number().int().positive(), from: dateSchema, to: dateSchema });
function days(year: number, month: number) { return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31; }
function date(year: number, month: number, day: number) { return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
export function shiftDate(value: string, offset: number) {
  dateSchema.parse(value);
  const parsed = new Date(`${value}T12:00:00Z`); parsed.setUTCDate(parsed.getUTCDate() + offset);
  const result = parsed.toISOString().slice(0, 10);
  return dateSchema.parse(result);
}
export function shiftMonth(value: string, offset: number) {
  monthSchema.parse(value);
  const ordinal = Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1 + offset;
  const year = Math.floor(ordinal / 12);
  if (year < 1 || year > 9999) throw new Error("The selected period is outside the supported dates.");
  return `${String(year).padStart(4, "0")}-${String(ordinal % 12 + 1).padStart(2, "0")}`;
}
export function budgetCycle(month: string, startDay = 1, version = 1) {
  const valid = monthSchema.parse(month); cycleStartDaySchema.parse(startDay);
  const year = Number(valid.slice(0, 4)); const number = Number(valid.slice(5));
  const from = date(year, number, Math.min(startDay, days(year, number)));
  const next = valid === "9999-12" ? null : shiftMonth(valid, 1);
  const to = next === null ? "9999-12-31" : shiftDate(budgetCycleStart(next, startDay), -1);
  return { startDay, version, from, to };
}
function budgetCycleStart(month: string, day: number) { return date(Number(month.slice(0, 4)), Number(month.slice(5)), Math.min(day, days(Number(month.slice(0, 4)), Number(month.slice(5))))); }
export function today(now = new Date()) { return date(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()); }
export function cycleHistory(sheet: CycleSheet): CycleHistory { return sheet.cycleHistory ?? { baselineDay: sheet.cycleStartDay ?? 1, revisions: [] }; }
export function periodContaining(value: string, sheet: CycleSheet = {}) {
  dateSchema.parse(value);
  const history = cycleHistory(sheet);
  const revision = [...history.revisions].reverse().find((row) => row.transitionFrom <= value);
  const startDay = revision?.startDay ?? history.baselineDay;
  if (revision && value < revision.recurringFrom) return { from: revision.transitionFrom, to: shiftDate(revision.recurringFrom, -1), startDay, version: sheet.cycleVersion ?? 1 };
  let month = value.slice(0, 7);
  if (value < budgetCycleStart(month, startDay) && month !== "0001-01") month = shiftMonth(month, -1);
  const regular = budgetCycle(month, startDay, sheet.cycleVersion ?? 1);
  // The supported date range includes the days before the first possible start.
  if (month === "0001-01" && value < regular.from) { regular.to = shiftDate(regular.from, -1); regular.from = "0001-01-01"; }
  const upcoming = history.revisions.find((row) => row.transitionFrom > regular.from && row.transitionFrom <= regular.to);
  if (upcoming) regular.to = shiftDate(upcoming.transitionFrom, -1);
  return regular;
}
export function resolvePeriod(key: string, sheet: CycleSheet = {}) {
  periodKeySchema.parse(key);
  if (key.length === 10) return periodContaining(key, sheet);
  // Legacy month links select the first period starting in that month.
  const first = periodContaining(`${key}-01`, sheet);
  if (first.from.slice(0, 7) === key || first.to === "9999-12-31") return first;
  const next = periodContaining(shiftDate(first.to, 1), sheet);
  return next.from.slice(0, 7) === key ? next : first;
}
export function currentCycleMonth(startDay = 1, now = new Date()) { return periodContaining(date(now.getFullYear(), now.getMonth() + 1, now.getDate()), { cycleStartDay: startDay }).from.slice(0, 7); }
export function currentPeriod(sheet: CycleSheet = {}, now = new Date()) { return periodContaining(today(now), sheet).from; }
export function adjacentPeriod(key: string, offset: -1 | 1, sheet: CycleSheet = {}) {
  const period = resolvePeriod(key, sheet);
  if (offset === -1 && period.from === "0001-01-01" || offset === 1 && period.to === "9999-12-31") return period.from;
  return periodContaining(shiftDate(offset === -1 ? period.from : period.to, offset), sheet).from;
}
export const cycleChangeSchema = z.object({ startDay: cycleStartDaySchema, effectiveDate: dateSchema, transition: z.enum(["short", "long"]) });
export function previewCycleChange(sheet: CycleSheet, input: z.infer<typeof cycleChangeSchema>, onDate = today()) {
  const change = cycleChangeSchema.parse(input);
  if (change.effectiveDate < onDate) throw new Error("Choose an effective date today or later.");
  if (budgetCycleStart(change.effectiveDate.slice(0, 7), change.startDay) !== change.effectiveDate) throw new Error("The effective date must match the chosen monthly start day, clamped for a short month.");
  const before = periodContaining(shiftDate(change.effectiveDate, -1), sheet);
  const aligned = change.transition === "short" && change.effectiveDate === shiftDate(before.to, 1);
  if (aligned && change.startDay === before.startDay) throw new Error("This schedule already uses that start day. Choose a different day or an intentional longer transition.");
  const transitionKind = aligned ? "aligned" : change.transition;
  const transitionFrom = aligned ? change.effectiveDate : change.transition === "short" ? before.from : adjacentPeriod(before.from, -1, sheet);
  const original = aligned ? before : resolvePeriod(transitionFrom, sheet);
  if (!aligned && (change.transition === "short" && change.effectiveDate > original.to || change.transition === "long" && change.effectiveDate <= original.to)) throw new Error("Choose an effective date that creates the selected shorter or longer transition.");
  if (transitionFrom < periodContaining(onDate, sheet).from) throw new Error("This change would alter a completed period. Choose a later effective date.");
  const history = cycleHistory(sheet);
  const latest = history.revisions.at(-1);
  if (latest && transitionFrom < latest.recurringFrom) throw new Error("This change would replace a scheduled transition. Choose a date after that transition.");
  const revision = { transitionFrom, recurringFrom: change.effectiveDate, startDay: change.startDay };
  const nextSheet = { ...sheet, cycleVersion: (sheet.cycleVersion ?? 1) + 1, cycleHistory: { ...history, revisions: [...history.revisions, revision] } };
  return { revision, original, transitionKind, currentBefore: periodContaining(onDate, sheet), currentAfter: periodContaining(onDate, nextSheet), transition: aligned ? before : resolvePeriod(transitionFrom, nextSheet), next: resolvePeriod(change.effectiveDate, nextSheet), nextSheet };
}
export function cycleRangeLabel(cycle: Pick<z.infer<typeof cycleSchema>, "from" | "to">) {
  const format = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return `${format(cycle.from)} through ${format(cycle.to)}. Both dates included`;
}
