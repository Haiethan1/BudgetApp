import { asc, eq } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, categories } from "../db/schema";
import { readBudgets } from "../budgets/service";
import { listTransactions } from "../ledger/service";

export function readOverview(userId: string, sheetId: string, month: string, connection: ReturnType<typeof openDatabase> = getDatabase()) {
  return connection.sqlite.transaction(() => {
    const budget = readBudgets(userId, sheetId, month, connection);
    const lastDay = new Date(Number(budget.month.slice(0, 4)), Number(budget.month.slice(5)), 0).getDate();
    const ledger = listTransactions(userId, sheetId, { from: `${budget.month}-01`, to: `${budget.month}-${lastDay}` }, connection);
    const attribution = connection.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).orderBy(asc(buckets.name), asc(buckets.id)).all()
      .map((bucket) => ({ id: bucket.id, name: bucket.name, archived: bucket.isArchived, protected: bucket.isProtected, spent: budget.buckets[bucket.id] ?? 0 }))
      .filter((bucket) => bucket.spent !== 0 || (!bucket.protected && !bucket.archived));
    const uncategorizedId = connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).all().find((category) => category.isProtected)?.id;
    if (!uncategorizedId) throw new Error("Missing Uncategorized category.");
    return { ...budget, attribution, uncategorizedId, recent: ledger.transactions.slice(0, 5), monthTransactionCount: ledger.total, hasTransactions: ledger.hasTransactions };
  })();
}
