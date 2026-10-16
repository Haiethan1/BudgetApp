import { adjacentPeriod, periodContaining, shiftMonth, type CycleSheet } from "../sheets/cycle";

export function exactPlanAmount(value: bigint) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error("Planning totals exceed the supported currency range.");
  return amount;
}
export function contributionSchedule({ expected, completed, startDate, dueDate, sheet }: { expected: number; completed: number; startDate: string; dueDate: string; sheet: CycleSheet }) {
  if (completed > expected) throw new Error("Expected amount cannot be below completed Planned contributions. Cancel the plan to release them instead.");
  const start = periodContaining(startDate, sheet).from;
  const last = periodContaining(dueDate, sheet).from;
  const periods: ReturnType<typeof periodContaining>[] = [];
  let cursor = start;
  while (cursor <= last) {
    periods.push(periodContaining(cursor, sheet));
    if (cursor === last) break;
    const next = adjacentPeriod(cursor, 1, sheet);
    if (next === cursor) throw new Error("Planning dates exceed the supported range.");
    cursor = next;
  }
  if (!periods.length) return [];
  const remaining = BigInt(expected) - BigInt(completed);
  const base = remaining / BigInt(periods.length); const remainder = remaining % BigInt(periods.length);
  return periods.map((period, index) => ({ from: period.from, to: period.to, amount: exactPlanAmount(base + (BigInt(index) < remainder ? 1n : 0n)) }));
}
export function nextOccurrence(dueDate: string, recurrence: number, anchorDay: number, onDate: string) {
  if (!recurrence) return { date: null, skipped: 0 };
  let month = dueDate.slice(0, 7); let skipped = 0;
  try {
    for (;;) {
      month = shiftMonth(month, recurrence);
      const nextMonth = month === "9999-12" ? null : shiftMonth(month, 1);
      const lastDay = nextMonth ? new Date(`${nextMonth}-01T12:00:00Z`).getTime() - 86400000 : new Date("9999-12-31T12:00:00Z").getTime();
      const day = Math.min(anchorDay, new Date(lastDay).getUTCDate());
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (date >= onDate) return { date, skipped };
      skipped++;
    }
  } catch { return { date: null, skipped }; }
}
