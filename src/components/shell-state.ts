import { z } from "zod";
export const sections = ["overview", "transactions", "budgets", "import", "settings"] as const;
export type Section = typeof sections[number];
export const monthSchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
export function currentMonth(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
export function selectedMonth(value: unknown, fallback = currentMonth()) { const parsed = monthSchema.safeParse(value); return parsed.success ? parsed.data : fallback; }
export function monthLabel(month: string) { const valid = monthSchema.parse(month); return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(Number(valid.slice(0, 4)), Number(valid.slice(5)) - 1, 1)); }
export function sheetHref(id: string, section: Section, month?: string) { return `/sheets/${encodeURIComponent(id)}${section === "overview" ? "" : `/${section}`}${month ? `?month=${monthSchema.parse(month)}` : ""}`; }
export function monthOptions(month: string) {
  const valid = monthSchema.parse(month);
  return Array.from({ length: 25 }, (_, index) => {
    const date = new Date(Number(valid.slice(0, 4)), Number(valid.slice(5)) - 13 + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }).filter((value) => monthSchema.safeParse(value).success);
}
