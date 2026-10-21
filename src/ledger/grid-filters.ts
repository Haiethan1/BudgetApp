import { z } from "zod";
import { ledgerFilters } from "./input";
export type GridFilters = { view: "expenses" | "all"; batchId: string; payee: string; from: string; to: string; accountId: string; kind: string; categoryId: string; bucketId: string };
export const emptyGridFilters: GridFilters = { view: "expenses", batchId: "", payee: "", from: "", to: "", accountId: "", kind: "", categoryId: "", bucketId: "" };
export type LedgerQuery = Partial<Record<keyof GridFilters, string>>;
export function initialGridFilters({ from, to, query = {} }: { from: string; to: string; query?: LedgerQuery }): GridFilters {
  return { ...emptyGridFilters, ...(query.batchId ? {} : { from, to }), ...query, view: query.view === "all" || Boolean(query.kind) ? "all" : "expenses" };
}
export function gridFilterInput(filters: GridFilters, page = 1): z.infer<typeof ledgerFilters> {
  return ledgerFilters.parse({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")), page });
}
