import { periodKeySchema } from "../sheets/cycle";
export const sections = ["overview", "transactions", "owed", "budgets", "import", "settings"] as const;
export type Section = typeof sections[number];
export const monthSchema = periodKeySchema;
export function currentMonth(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
export function selectedMonth(value: unknown, fallback = currentMonth()) { const parsed = monthSchema.safeParse(value); return parsed.success ? parsed.data : fallback; }
export function monthLabel(month: string) { const valid = monthSchema.parse(month); return new Intl.DateTimeFormat("en-US", { month: "long", ...(valid.length === 10 ? { day: "numeric" as const } : {}), year: "numeric", timeZone: "UTC" }).format(new Date(`${valid.length === 7 ? valid + "-01" : valid}T12:00:00Z`)); }
export function pageHref(section: Section, month?: string) { return `/${section}${month ? `?month=${monthSchema.parse(month)}` : ""}`; }
export function monthOptions(month: string) {
  const valid = monthSchema.parse(month);
  return Array.from({ length: 25 }, (_, index) => {
    const date = new Date(Number(valid.slice(0, 4)), Number(valid.slice(5, 7)) - 13 + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }).filter((value) => monthSchema.safeParse(value).success);
}
