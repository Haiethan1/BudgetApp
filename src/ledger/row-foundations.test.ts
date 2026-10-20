import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { ledgerRequests, sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { deleteTransaction, listTransactions, readTransaction, saveTransaction } from "./service";
import { draftInput, recordDraft } from "./presentation";
import { readExport } from "../exports/service";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-grid-"));
  const filename = path.join(directory, "test.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename);
  cleanups.push(() => { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
  for (const id of [owner, member, outsider]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test` }).run();
  const sheet = createSheet(owner, { name: "Grid", currency: "USD" }, connection).sheet;
  connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: member, acceptedAt: new Date() }).run();
  for (const name of ["Card", "Cash"]) mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name, sourceType: "cash" }, connection);
  mutateSettings(owner, sheet.id, { kind: "create", entity: "category", name: "Groceries" }, connection);
  mutateSettings(owner, sheet.id, { kind: "create", entity: "bucket", name: "Parents" }, connection);
  const full = readSheet(owner, sheet.id, connection);
  const account = full.accounts.find(row => row.name === "Card"), other = full.accounts.find(row => row.name === "Cash");
  const category = full.categories.find(row => row.name === "Groceries"), uncategorized = full.categories.find(row => row.isProtected);
  const me = full.buckets.find(row => row.isProtected), parents = full.buckets.find(row => row.name === "Parents");
  if (!account || !other || !category || !uncategorized || !me || !parents) throw new Error("Missing fixture organization");
  const expense = { accountId: account.id, date: "2026-10-04", payee: "Market", kind: "expense", amount: "-1.00", splits: [{ categoryId: category.id, bucketId: me.id, amount: "-0.60" }, { categoryId: uncategorized.id, bucketId: parents.id, amount: "-0.40" }] };
  return { directory, filename, connection, owner, member, outsider, sheet, account, other, category, uncategorized, me, parents, expense };
}

it("replays create and update snapshots across later changes, deletion and connection restart, with access checks", () => {
  const f = fixture();
  const create = { ...f.expense, notes: "Switch to yearly?\nKeep receipt", requestId: randomUUID() };
  const first = saveTransaction(f.owner, f.sheet.id, create, undefined, f.connection);
  const edit = { ...create, requestId: randomUUID(), version: first.version, notes: "Updated" };
  const second = saveTransaction(f.owner, f.sheet.id, edit, { id: first.id }, f.connection);
  expect(saveTransaction(f.owner, f.sheet.id, create, undefined, f.connection)).toEqual(first);
  expect(() => saveTransaction(f.owner, f.sheet.id, { ...edit, notes: "Different" }, { id: first.id }, f.connection)).toThrow("already used");
  expect(() => saveTransaction(f.member, f.sheet.id, create, undefined, f.connection)).toThrow("already used");
  expect(() => saveTransaction(f.outsider, f.sheet.id, create, undefined, f.connection)).toThrow();
  expect(() => saveTransaction(f.owner, f.sheet.id, { ...edit, requestId: randomUUID() }, { id: first.id }, f.connection)).toThrow("Someone updated");
  deleteTransaction(f.owner, f.sheet.id, first.id, { version: second.version }, f.connection);
  const restarted = openDatabase(f.filename);
  try {
    expect(saveTransaction(f.owner, f.sheet.id, edit, { id: first.id }, restarted)).toEqual(second);
    expect(saveTransaction(f.owner, f.sheet.id, create, undefined, restarted)).toEqual(first);
    expect(listTransactions(f.owner, f.sheet.id, {}, restarted).total).toBe(0);
  } finally { restarted.sqlite.close(); }
  f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, f.member)).run();
  expect(() => saveTransaction(f.member, f.sheet.id, create, undefined, f.connection)).toThrow();
});

it("rolls back request identity with failed writes and preserves complex allocations and notes on old-client updates", () => {
  const f = fixture();
  const input = { ...f.expense, notes: "=SUM(1,2)\nReminder", requestId: randomUUID(), splits: [...f.expense.splits.slice(0, 1).map(row => ({ ...row, amount: "-0.30" })), { categoryId: f.uncategorized.id, bucketId: f.me.id, amount: "-0.30" }, f.expense.splits[1]] };
  f.connection.sqlite.exec("CREATE TRIGGER fail_request BEFORE INSERT ON ledger_requests BEGIN SELECT RAISE(ABORT, 'request write failed'); END");
  expect(() => saveTransaction(f.owner, f.sheet.id, input, undefined, f.connection)).toThrow("request write failed");
  expect(listTransactions(f.owner, f.sheet.id, {}, f.connection).total).toBe(0);
  expect(f.connection.db.select().from(ledgerRequests).all()).toHaveLength(0);
  f.connection.sqlite.exec("DROP TRIGGER fail_request");
  const record = saveTransaction(f.owner, f.sheet.id, input, undefined, f.connection);
  const draft = recordDraft(record, "USD");
  const normalized = draftInput(draft, "USD", { categoryId: f.uncategorized.id, bucketId: f.me.id });
  expect(normalized.notes).toBe(input.notes);
  expect(normalized.splits).toEqual(input.splits);
  const updated = saveTransaction(f.owner, f.sheet.id, { ...f.expense, splits: input.splits, payee: "Changed", version: 1 }, { id: record.id }, f.connection);
  expect(updated.notes).toBe(input.notes);
  const exported = readExport(f.owner, f.sheet.id, { kind: "all" }, f.connection);
  const table = exported.find(row => row.name === "Transactions"); expect(table).toBeDefined();
  expect(table?.rows[0]?.[table.headers.indexOf("Notes")]).toBe(input.notes);
  expect(() => saveTransaction(f.owner, f.sheet.id, { ...input, notes: "x".repeat(2001) }, undefined, f.connection)).toThrow();
  const cleared = saveTransaction(f.owner, f.sheet.id, { ...f.expense, splits: input.splits, version: updated.version, notes: "" }, { id: record.id }, f.connection);
  expect(readTransaction(f.owner, f.sheet.id, cleared.id, f.connection).notes).toBe("");
});

it("summarizes full matching transactions across pages, categories, people, accounts and kinds", () => {
  const f = fixture();
  for (let i = 0; i < 51; i++) saveTransaction(f.owner, f.sheet.id, f.expense, undefined, f.connection);
  saveTransaction(f.owner, f.sheet.id, { ...f.expense, kind: "refund", amount: "0.20", splits: [{ categoryId: f.category.id, bucketId: f.me.id, amount: "0.20" }] }, undefined, f.connection);
  saveTransaction(f.owner, f.sheet.id, { ...f.expense, accountId: f.other.id }, undefined, f.connection);
  saveTransaction(f.owner, f.sheet.id, { ...f.expense, kind: "transfer" }, undefined, f.connection);
  const filters = { accountId: f.account.id, from: "2026-10-01", to: "2026-10-31", payee: "Market" };
  const expected = { total: 5080, buckets: { [f.me.id]: 3040, [f.parents.id]: 2040 } };
  const first = listTransactions(f.owner, f.sheet.id, filters, f.connection);
  expect(first.transactions).toHaveLength(50); expect(first.summary).toEqual(expected);
  expect(listTransactions(f.owner, f.sheet.id, { ...filters, page: 2 }, f.connection).summary).toEqual(expected);
  expect(listTransactions(f.owner, f.sheet.id, { ...filters, categoryId: f.category.id }, f.connection).summary).toEqual(expected);
  expect(listTransactions(f.owner, f.sheet.id, { ...filters, bucketId: f.parents.id }, f.connection).summary).toEqual({ total: 5100, buckets: { [f.me.id]: 3060, [f.parents.id]: 2040 } });
  expect(listTransactions(f.owner, f.sheet.id, { ...filters, kind: "transfer" }, f.connection).summary).toEqual({ total: 0, buckets: {} });
  expect(listTransactions(f.owner, f.sheet.id, { ...filters, payee: "Missing" }, f.connection).summary).toEqual({ total: 0, buckets: {} });
  expect(() => listTransactions(f.outsider, f.sheet.id, filters, f.connection)).toThrow();
});

it("rejects aggregate overflow while allowing exact expense/refund cancellations", () => {
  const f = fixture();
  const maximal = { ...f.expense, amount: "-90071992547409.91", splits: [{ categoryId: f.category.id, bucketId: f.me.id, amount: "-90071992547409.91" }] };
  saveTransaction(f.owner, f.sheet.id, maximal, undefined, f.connection);
  saveTransaction(f.owner, f.sheet.id, maximal, undefined, f.connection);
  expect(() => listTransactions(f.owner, f.sheet.id, {}, f.connection)).toThrow("supported range");
  saveTransaction(f.owner, f.sheet.id, { ...maximal, kind: "refund", amount: "90071992547409.91", splits: maximal.splits.map(row => ({ ...row, amount: "90071992547409.91" })) }, undefined, f.connection);
  expect(listTransactions(f.owner, f.sheet.id, {}, f.connection).summary.total).toBe(Number.MAX_SAFE_INTEGER);
});

it("upgrades populated databases with empty notes without changing historical transactions or splits", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-grid-upgrade-"));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const migrations = path.join(directory, "drizzle"); fs.mkdirSync(path.join(migrations, "meta"), { recursive: true });
  for (const entry of fs.readdirSync("drizzle")) if (entry.endsWith(".sql") && !entry.startsWith("0019_")) fs.copyFileSync(path.join("drizzle", entry), path.join(migrations, entry));
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 19);
  fs.writeFileSync(path.join(migrations, "meta/_journal.json"), JSON.stringify(journal));
  const filename = path.join(directory, "legacy.sqlite"); migrateDatabase(filename, migrations);
  const legacy = openDatabase(filename);
  const owner = randomUUID(), sheetId = randomUUID(), accountId = randomUUID(), categoryId = randomUUID(), bucketId = randomUUID(), transactionId = randomUUID();
  try {
    legacy.sqlite.prepare("INSERT INTO user (id,name,email,created_at,updated_at) VALUES (?,?,?,0,0)").run(owner, "Owner", `${owner}@example.test`);
    legacy.sqlite.prepare("INSERT INTO sheets (id,name,currency,owner_id,created_at) VALUES (?,?,?,?,0)").run(sheetId, "Legacy", "USD", owner);
    legacy.sqlite.prepare("INSERT INTO financial_accounts (id,sheet_id,name,source_type,created_at,updated_at) VALUES (?,?,?,?,0,0)").run(accountId, sheetId, "Card", "cash");
    legacy.sqlite.prepare("INSERT INTO categories (id,sheet_id,name) VALUES (?,?,?)").run(categoryId, sheetId, "Old category");
    legacy.sqlite.prepare("INSERT INTO buckets (id,sheet_id,name) VALUES (?,?,?)").run(bucketId, sheetId, "Old person");
    legacy.sqlite.prepare("INSERT INTO transactions (id,sheet_id,account_id,date,payee,kind,amount,creator_id,created_at,updated_at) VALUES (?,?,?,?,?,'expense',-123,?,0,0)").run(transactionId, sheetId, accountId, "2026-10-01", "Historical", owner);
    legacy.sqlite.prepare("INSERT INTO splits (id,sheet_id,transaction_id,category_id,bucket_id,amount,position) VALUES (?,?,?,?,?,-123,0)").run(randomUUID(), sheetId, transactionId, categoryId, bucketId);
  } finally { legacy.sqlite.close(); }
  migrateDatabase(filename);
  const upgraded = openDatabase(filename);
  try {
    expect(readTransaction(owner, sheetId, transactionId, upgraded)).toMatchObject({ notes: "", amount: -123, version: 1, splits: [{ amount: -123, categoryId, bucketId }] });
    expect(upgraded.db.select().from(ledgerRequests).all()).toEqual([]);
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally { upgraded.sqlite.close(); }
});
