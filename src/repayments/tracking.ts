import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, debts, debtSources, debtTrackingRequests, splits, transactions } from "../db/schema";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { trackingInput } from "./debt-input";
import { ensureDebtSpendingGroup } from "./groups";

type Connection = ReturnType<typeof openDatabase>;

// Runs inside the authorized caller's write transaction, including CSV imports.
export function trackExpensePortions(sheetId: string, c: Connection, transactionId?: string) {
  const portions = c.db.select({ transaction: transactions, split: splits, group: buckets }).from(splits)
    .innerJoin(transactions, eq(transactions.id, splits.transactionId))
    .innerJoin(buckets, eq(buckets.id, splits.bucketId))
    .where(and(eq(transactions.sheetId, sheetId), eq(transactions.kind, "expense"), isNull(transactions.deletedAt), eq(buckets.trackRepayment, true), transactionId ? eq(transactions.id, transactionId) : undefined)).all();
  for (const { transaction: t, split: s, group: g } of portions) {
    if (!g.repaymentRecipient) continue;
    const claims = c.db.select().from(debtSources).where(eq(debtSources.transactionId, t.id)).all();
    if (claims.some(claim => claim.position === s.position || claim.originalVersion !== t.version)) continue;
    const id = randomUUID(), now = Date.now();
    c.db.insert(debts).values({ id, sheetId, description: t.payee, debtor: g.name, recipient: g.repaymentRecipient, total: -s.amount, createdAt: now, updatedAt: now }).run();
    c.db.insert(debtSources).values({ id: randomUUID(), sheetId, debtId: id, transactionId: t.id, position: s.position, originalVersion: t.version, acceptedVersion: t.version, amount: -s.amount, originalAmount: -s.amount, payee: t.payee, date: t.date, bucketId: g.id, bucketName: g.name }).run();
  }
}

export function configureTracking(userId: string, sheetId: string, input: unknown, c: Connection = getDatabase()) {
  const p = trackingInput.parse(input);
  return c.sqlite.transaction(() => {
    requireSheetAccess({ userId, sheetId }, c);
    const hash = createHash("sha256").update(JSON.stringify(p)).digest("hex");
    const prior = c.db.select().from(debtTrackingRequests).where(and(eq(debtTrackingRequests.sheetId, sheetId), eq(debtTrackingRequests.id, p.requestId))).get();
    if (prior) {
      if (prior.hash !== hash) throw new SheetError("This request was already used for different tracking changes. Reload latest.", 409);
      return { saved: true };
    }
    const group = c.db.select().from(buckets).where(and(eq(buckets.sheetId, sheetId), eq(buckets.id, p.bucketId))).get();
    if (!group || group.isProtected) throw new SheetError("Choose a custom person or group from this sheet.", 400);
    if (group.trackingVersion !== p.version) throw new SheetError("Someone changed tracking for this group. Reload latest before saving.", 409);
    const recipient = p.tracking.enabled ? ensureDebtSpendingGroup(sheetId, p.tracking.recipient, c) : group.repaymentRecipient;
    c.db.update(buckets).set({ trackRepayment: p.tracking.enabled, repaymentRecipient: recipient, trackingVersion: group.trackingVersion + 1 }).where(eq(buckets.id, group.id)).run();
    if (p.tracking.enabled) trackExpensePortions(sheetId, c);
    c.db.insert(debtTrackingRequests).values({ id: p.requestId, sheetId, hash }).run();
    return { saved: true };
  }).immediate();
}
