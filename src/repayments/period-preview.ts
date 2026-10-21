import { createHash } from "node:crypto";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, debts, debtSources, financialAccounts, splits, transactions } from "../db/schema";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { readDebt } from "./debts";
import { periodScopeSchema, type PeriodPreview } from "./period-input";
import type { groupDebtInput } from "./debt-input";
import type { z } from "zod";

type Connection = ReturnType<typeof openDatabase>;
function exact(value: bigint) { const number = Number(value); if (!Number.isSafeInteger(number)) throw new SheetError("Period amounts exceed the supported range. Choose a smaller date range.", 400); return number; }
export function previewPeriodDebt(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()): PeriodPreview {
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const parsed = periodScopeSchema.parse(input);
    const people = connection.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).orderBy(asc(buckets.id)).all();
    const person = people.find(person => person.id === parsed.bucketId);
    const recipient = people.find(person => person.name.normalize("NFKC").toLocaleLowerCase("en-US") === parsed.recipient.normalize("NFKC").toLocaleLowerCase("en-US"));
    const accounts = connection.db.select().from(financialAccounts).where(eq(financialAccounts.sheetId, sheetId)).orderBy(asc(financialAccounts.id)).all();
    const account = accounts.find(account => account.id === parsed.accountId);
    if (!person || !recipient) throw new SheetError("Choose a person and an explicit recipient from this sheet.", 400);
    if (parsed.accountId && !account) throw new SheetError("Choose an account from this sheet.", 400);
    const scope = { ...parsed, recipient: recipient.name };
    const ledger = connection.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), isNull(transactions.deletedAt), gte(transactions.date, scope.from), lte(transactions.date, scope.to), scope.accountId ? eq(transactions.accountId, scope.accountId) : undefined)).orderBy(asc(transactions.id)).all();
    const parts = connection.db.select().from(splits).where(and(eq(splits.sheetId, sheetId), eq(splits.bucketId, person.id))).orderBy(asc(splits.transactionId), asc(splits.position)).all();
    const inScopeParts = parts.flatMap(split => { const transaction = ledger.find(transaction => transaction.id === split.transactionId); return transaction && (transaction.kind === "expense" || transaction.kind === "refund") ? [{ transaction, split }] : []; });
    const transactionIds = new Set(inScopeParts.map(row => row.transaction.id));
    const claims = connection.db.select().from(debtSources).where(eq(debtSources.sheetId, sheetId)).orderBy(asc(debtSources.transactionId), asc(debtSources.position)).all();
    const relatedDebtIds = new Set(claims.filter(claim => transactionIds.has(claim.transactionId)).map(claim => claim.debtId));
    const agreements = connection.db.select().from(debts).where(and(eq(debts.sheetId, sheetId), isNull(debts.groupedInto))).orderBy(asc(debts.id)).all().filter(debt => debt.debtor === person.name || relatedDebtIds.has(debt.id));
    const eligibleDebts: PeriodPreview["debts"] = [], exclusions: PeriodPreview["exclusions"] = [];
    const agreementEvidence: { id: string; version: number; total: number; paid: number; sources: ReturnType<typeof readDebt>["sources"] }[] = [];
    for (const debt of agreements) {
      const current = readDebt(userId, sheetId, debt.id, connection);
      agreementEvidence.push({ id: debt.id, version: debt.version, total: debt.total, paid: current.paid, sources: current.sources });
      let reason = "";
      if (!debt.recipient) reason = "Recipient needs clarification.";
      else if (debt.debtor !== person.name || debt.recipient !== recipient.name) reason = `Other direction: ${debt.debtor} to ${debt.recipient}.`;
      else if (!current.sources.length) reason = "Standalone agreement; it is not a purchase in this period.";
      else if (current.needsReview) reason = "Linked sources need review before grouping.";
      else if (current.total <= 0) reason = "No positive agreed amount to group.";
      else if (BigInt(current.total) !== current.sources.reduce((sum, source) => sum + BigInt(source.amount), 0n)) reason = "Includes a standalone amount; keep it separate from period purchases.";
      else if (current.sources.some(source => source.bucketId !== person.id || !inScopeParts.some(row => row.transaction.id === source.transactionId && row.split.position === source.position && row.split.bucketId === person.id && row.transaction.kind === "expense"))) reason = "Contains sources outside these dates/account or a different person's shares.";
      if (reason) { exclusions.push({ label: debt.description, reason, debtId: debt.id }); continue; }
      eligibleDebts.push({ id: debt.id, version: debt.version, description: debt.description, total: debt.total, paid: current.paid, remaining: current.remaining,
        sources: current.sources.map(source => { const transaction = ledger.find(row => row.id === source.transactionId); return { transactionId: source.transactionId, version: source.currentVersion, position: source.position, amount: source.amount, payee: source.currentPayee, date: source.currentDate, accountName: accounts.find(account => account.id === transaction?.accountId)?.name ?? "Historical account" }; }) });
    }
    const eligibleIds = new Set(eligibleDebts.map(debt => debt.id));
    const sources: PeriodPreview["sources"] = [];
    let expenseTotal = 0n, refundTotal = 0n;
    for (const { transaction, split } of inScopeParts) {
      if (transaction.kind === "refund") { refundTotal += BigInt(split.amount); continue; }
      expenseTotal -= BigInt(split.amount);
      const claim = claims.find(claim => claim.transactionId === transaction.id && claim.position === split.position);
      if (claim) {
        if (!eligibleIds.has(claim.debtId)) exclusions.push({ label: `${transaction.payee} · portion ${split.position + 1}`, reason: "Already owned by an excluded agreement; inspect it before grouping.", transactionId: transaction.id, debtId: claim.debtId });
        continue;
      }
      if (claims.some(claim => claim.transactionId === transaction.id && claim.originalVersion !== transaction.version)) { exclusions.push({ label: `${transaction.payee} · portion ${split.position + 1}`, reason: "This transaction changed after a portion was claimed. New claims are blocked; group its existing agreements after review.", transactionId: transaction.id }); continue; }
      sources.push({ transactionId: transaction.id, version: transaction.version, position: split.position, amount: -split.amount, payee: transaction.payee, date: transaction.date, accountName: accounts.find(account => account.id === transaction.accountId)?.name ?? "Historical account" });
    }
    const evidence = { scope, cycleVersion: sheet.cycleVersion, person, recipient, account: account ?? null,
      portions: inScopeParts.map(({ transaction, split }) => ({ transactionId: transaction.id, version: transaction.version, kind: transaction.kind, date: transaction.date, accountId: transaction.accountId, split })),
      claims: claims.filter(claim => transactionIds.has(claim.transactionId)), agreements: agreementEvidence, sources, debts: eligibleDebts, exclusions };
    const digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    return { scope, debtor: person.name, recipient: recipient.name, accountName: account?.name ?? "All accounts", digest, expenseTotal: exact(expenseTotal), refundTotal: exact(refundTotal), netSpending: exact(expenseTotal - refundTotal), eligibleTotal: exact(sources.reduce((sum, source) => sum + BigInt(source.amount), 0n) + eligibleDebts.reduce((sum, debt) => sum + BigInt(debt.total), 0n)), eligiblePaid: exact(eligibleDebts.reduce((sum, debt) => sum + BigInt(debt.paid), 0n)), sources, debts: eligibleDebts, exclusions };
  })();
}

export function validatePeriodGrouping(userId: string, sheetId: string, input: z.infer<typeof groupDebtInput>, connection: Connection) {
  if (!input.period) return;
  const latest = previewPeriodDebt(userId, sheetId, input.period.scope, connection);
  if (latest.digest !== input.period.digest) throw new SheetError("Period sources or repayments changed. Reload the preview before grouping.", 409);
  if (input.debtor !== latest.debtor || input.recipient !== latest.recipient) throw new SheetError("Use the debtor and recipient from the period preview.", 409);
  if (latest.refundTotal > 0 && !input.period.refundAcknowledged) throw new SheetError("Acknowledge that gross expenses are tracked and refunds remain separate.", 400);
  if (input.sources.some(source => source.position === null || !latest.sources.some(candidate => candidate.transactionId === source.transactionId && candidate.position === source.position && candidate.version === source.version))
    || input.debts.some(debt => !latest.debts.some(candidate => candidate.id === debt.id && candidate.version === debt.version))) throw new SheetError("Choose only eligible entries from this period preview.", 409);
}
