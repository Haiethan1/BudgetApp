import { getDatabase, type openDatabase } from "../db/client";
import { requireSheetAccess, SheetError } from "../sheets/service";
export { listDebts as listOwed } from "./debts";
type Connection = ReturnType<typeof openDatabase>;
export function saveRepayment(userId: string, sheetId: string, _id: string, _input: unknown, connection: Connection = getDatabase()): never {
  requireSheetAccess({ userId, sheetId }, connection);
  throw new SheetError("Whole-expense settlement has moved to debt repayment history in Amount owed. Reload the page.", 409);
}
export function saveTracking(userId: string, sheetId: string, _input: unknown, connection: Connection = getDatabase()): never {
  requireSheetAccess({ userId, sheetId }, connection);
  throw new SheetError("Spending allocations no longer create debts automatically. Select sources explicitly in Amount owed.", 409);
}
