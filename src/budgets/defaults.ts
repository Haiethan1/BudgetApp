import { and, desc, eq, lte } from "drizzle-orm";
import type { openDatabase } from "../db/client";
import { budgetDefaultChanges } from "../db/schema";

export function effectiveDefault(sheetId: string, categoryId: string, period: string, connection: ReturnType<typeof openDatabase>) {
  return connection.db.select().from(budgetDefaultChanges).where(and(eq(budgetDefaultChanges.sheetId, sheetId), eq(budgetDefaultChanges.categoryId, categoryId), lte(budgetDefaultChanges.effectiveFrom, period))).orderBy(desc(budgetDefaultChanges.effectiveFrom), desc(budgetDefaultChanges.version)).get();
}
