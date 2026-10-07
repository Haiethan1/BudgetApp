import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { sharingRateLimits, sheetInvites, sheetMembers, user } from "../db/schema";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { createSheet, listSheets, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { deleteTransaction, listTransactions, saveTransaction } from "../ledger/service";
import { mutateBudget, readBudgets } from "../budgets/service";
import { createImportReview, confirmImportReview, readImportReview, updateImportReview } from "../imports/review";
import { mappingSchema } from "../imports/csv";
import { handleSharingRequest } from "./http";
import { incomingInvites, mutateSharing, readSharing, respondToInvite, searchInvitees, sharingLimits } from "./service";

const resources: { connection: ReturnType<typeof openDatabase>; directory: string }[] = [];
afterEach(() => { for (const { connection, directory } of resources.splice(0)) { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); } });
function database() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-sharing-"));
  const filename = path.join(directory, "sharing.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); resources.push({ connection, directory });
  return { connection, filename };
}
function fixture() {
  const { connection, filename } = database();
  const owner = randomUUID(); const member = randomUUID(); const other = randomUUID(); const admin = randomUUID();
  for (const [id, username, name] of [[owner, "owner", "Owner"], [member, "dana", "Dana"], [other, "dana2", "Dana"], [admin, "admin", "Admin"]]) {
    connection.db.insert(user).values({ id, username, name, email: `${username}@example.test`, isInstanceAdmin: id === admin, updatedAt: new Date() }).run();
  }
  const sheetId = createSheet(owner, { name: "Household", currency: "USD" }, connection).sheet.id;
  const invite = (recipient = member) => {
    const result = mutateSharing(owner, sheetId, { kind: "invite", userId: recipient }, connection);
    if (typeof result.id !== "string") throw new Error("Missing invitation.");
    return result.id;
  };
  const accept = (id: string, recipient = member) => respondToInvite(recipient, id, { kind: "accept" }, connection);
  return { connection, filename, owner, member, other, admin, sheetId, invite, accept };
}
it("limits owner search to display names and safe identity fields and excludes people with access or pending invitations", () => {
  const f = fixture();
  expect(searchInvitees(f.owner, f.sheetId, "Dana", f.connection)).toEqual([
    { id: f.member, name: "Dana", username: "dana" }, { id: f.other, name: "Dana", username: "dana2" },
  ]);
  expect(searchInvitees(f.owner, f.sheetId, "dana2", f.connection)).toEqual([]);
  expect(searchInvitees(f.owner, f.sheetId, "_%", f.connection)).toEqual([]);
  const id = f.invite();
  expect(searchInvitees(f.owner, f.sheetId, "Dana", f.connection).map((p) => p.id)).toEqual([f.other]);
  expect(incomingInvites(f.member, f.connection)).toEqual([expect.objectContaining({ id, sheetName: "Household", inviterName: "Owner", inviterUsername: "owner", state: "pending" })]);
  expect(Object.keys(incomingInvites(f.member, f.connection)[0]).sort()).toEqual(["createdAt", "id", "inviterName", "inviterUsername", "sheetId", "sheetName", "state"]);
  for (const actor of [f.member, f.other, f.admin]) {
    expect(() => searchInvitees(actor, f.sheetId, "Dana", f.connection)).toThrow("unavailable");
    expect(() => readSheet(actor, f.sheetId, f.connection)).toThrow("unavailable");
    expect(() => readBudgets(actor, f.sheetId, "2026-10", f.connection)).toThrow("unavailable");
    expect(() => listTransactions(actor, f.sheetId, {}, f.connection)).toThrow("unavailable");
    expect(() => mutateSharing(actor, f.sheetId, { kind: "invite", userId: f.other }, f.connection)).toThrow("unavailable");
  }
  expect(listSheets(f.member, f.connection)).toEqual([]);
  f.accept(id);
  expect(() => searchInvitees(f.member, f.sheetId, "Dana", f.connection)).toThrow("Only the sheet owner");
  expect(() => readSharing(f.member, f.sheetId, f.connection)).toThrow("Only the sheet owner");
  expect(searchInvitees(f.owner, f.sheetId, "Dana", f.connection).map((p) => p.id)).toEqual([f.other]);
});
it("enforces recipient transitions, duplicate invites, revoke, leave and new-invitation requirements", () => {
  const f = fixture(); const first = f.invite();
  expect(f.invite()).toBe(first);
  expect(() => f.accept(first, f.other)).toThrow("unavailable");
  respondToInvite(f.member, first, { kind: "decline" }, f.connection);
  expect(respondToInvite(f.member, first, { kind: "decline" }, f.connection).state).toBe("declined");
  expect(() => f.accept(first)).toThrow("no longer pending");
  const second = f.invite();
  mutateSharing(f.owner, f.sheetId, { kind: "revokeInvite", inviteId: second }, f.connection);
  expect(() => f.accept(second)).toThrow("no longer pending");
  const third = f.invite(); f.accept(third); f.accept(third);
  expect(f.connection.db.select().from(sheetMembers).all()).toHaveLength(1);
  expect(incomingInvites(f.member, f.connection)).toEqual([]);
  expect(() => f.invite()).toThrow("already has access");
  expect(() => mutateSharing(f.member, f.sheetId, { kind: "removeMember", userId: f.owner }, f.connection)).toThrow("Only the sheet owner");
  expect(() => mutateSharing(f.owner, f.sheetId, { kind: "leave" }, f.connection)).toThrow("owner cannot leave");
  expect(() => mutateSharing(f.owner, f.sheetId, { kind: "removeMember", userId: f.owner }, f.connection)).toThrow("owner cannot leave");
  mutateSharing(f.member, f.sheetId, { kind: "leave" }, f.connection);
  expect(() => f.accept(third)).toThrow("new invitation");
  const fourth = f.invite(); expect(fourth).not.toBe(third); f.accept(fourth);
  mutateSharing(f.owner, f.sheetId, { kind: "removeMember", userId: f.member }, f.connection);
  expect(() => f.accept(fourth)).toThrow("new invitation");
  expect(f.connection.db.select().from(sheetInvites).all().map((i) => i.state)).toEqual(["declined", "revoked", "accepted", "accepted"]);
  expect(f.connection.db.select().from(sheetMembers).all()).toEqual([]);
  const otherSheet = createSheet(f.owner, { name: "Other", currency: "USD" }, f.connection).sheet.id;
  expect(() => mutateSharing(f.owner, otherSheet, { kind: "revokeInvite", inviteId: first }, f.connection)).toThrow("unavailable");
});
it("rolls back membership if accepting cannot update the invitation", () => {
  const f = fixture(); const id = f.invite();
  f.connection.sqlite.exec("CREATE TRIGGER fail_accept BEFORE UPDATE ON sheet_invites BEGIN SELECT RAISE(ABORT, 'failed acceptance'); END");
  expect(() => f.accept(id)).toThrow("failed acceptance");
  expect(f.connection.db.select().from(sheetMembers).all()).toEqual([]);
  expect(f.connection.db.select().from(sheetInvites).get()?.state).toBe("pending");
});
it("persists per-user rate limits across connections and sheets and resets expired windows", () => {
  const f = fixture();
  for (let i = 0; i < sharingLimits.search.count; i++) searchInvitees(f.owner, f.sheetId, "Dana", f.connection);
  const second = openDatabase(f.filename);
  try { expect(() => searchInvitees(f.owner, f.sheetId, "Dana", second)).toThrow("Too many requests"); } finally { second.sqlite.close(); }
  const otherSheet = createSheet(f.owner, { name: "Other", currency: "USD" }, f.connection).sheet.id;
  expect(() => searchInvitees(f.owner, otherSheet, "Dana", f.connection)).toThrow("Too many requests");
  for (let i = 0; i < sharingLimits.invite.count; i++) f.invite();
  expect(() => f.invite()).toThrow("Too many requests");
  f.connection.db.update(sharingRateLimits).set({ windowStart: 0 }).run();
  expect(searchInvitees(f.owner, f.sheetId, "Dana", f.connection)).toHaveLength(1);
  expect(f.invite()).toBeDefined();
});
it("permits member editing, rejects stale versions, and blocks every tested next operation after removal", () => {
  const f = fixture(); f.accept(f.invite());
  mutateSettings(f.member, f.sheetId, { kind: "create", entity: "account", name: "Cash", sourceType: "cash" }, f.connection);
  const sheet = readSheet(f.member, f.sheetId, f.connection);
  const account = sheet.accounts[0]; const category = sheet.categories[0]; const bucket = sheet.buckets[0];
  if (!account || !category || !bucket) throw new Error("Missing fixture references.");
  const input = { accountId: account.id, kind: "expense", date: "2026-10-01", payee: "Shop", amount: "-10", splits: [{ amount: "-10", categoryId: category.id, bucketId: bucket.id }] };
  const transaction = saveTransaction(f.member, f.sheetId, input, undefined, f.connection);
  saveTransaction(f.owner, f.sheetId, { ...input, payee: "Changed", version: transaction.version }, { id: transaction.id }, f.connection);
  expect(() => saveTransaction(f.member, f.sheetId, { ...input, version: transaction.version }, { id: transaction.id }, f.connection)).toThrow("Someone updated");
  const budget = { kind: "save", categoryId: category.id, month: "2026-10", amount: "100", version: 0 };
  mutateBudget(f.member, f.sheetId, budget, f.connection);
  expect(() => mutateBudget(f.owner, f.sheetId, budget, f.connection)).toThrow("Someone updated");
  const mapping = mappingSchema.parse({ version: 1, profile: "Test", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } });
  const review = createImportReview(f.member, f.sheetId, account.id, new TextEncoder().encode("Date,Payee,Amount\n2026-10-02,Other,-5.00"), mapping, f.connection);
  mutateSharing(f.owner, f.sheetId, { kind: "removeMember", userId: f.member }, f.connection);
  for (const operation of [
    () => readSheet(f.member, f.sheetId, f.connection),
    () => listTransactions(f.member, f.sheetId, {}, f.connection),
    () => saveTransaction(f.member, f.sheetId, input, undefined, f.connection),
    () => saveTransaction(f.member, f.sheetId, { ...input, version: 1 }, { id: transaction.id }, f.connection),
    () => deleteTransaction(f.member, f.sheetId, transaction.id, { version: 1 }, f.connection),
    () => readBudgets(f.member, f.sheetId, "2026-10", f.connection),
    () => mutateBudget(f.member, f.sheetId, { ...budget, version: 1 }, f.connection),
    () => readImportReview(f.member, f.sheetId, review.id, f.connection),
    () => updateImportReview(f.member, f.sheetId, review.id, { version: review.version, rowId: review.rows[0]?.id, decision: "keep", kindReviewed: true }, f.connection),
    () => confirmImportReview(f.member, f.sheetId, review.id, { version: review.version }, f.connection),
    () => mutateSettings(f.member, f.sheetId, { kind: "create", entity: "category", name: "Stale" }, f.connection),
  ]) expect(operation).toThrow("unavailable");
  expect(listTransactions(f.owner, f.sheetId, {}, f.connection).transactions).toHaveLength(1);
});
const execute = promisify(execFile);
async function race(f: ReturnType<typeof fixture>, actions: { actor: string; kind: string; target: string }[]) {
  return Promise.all(actions.map(async ({ actor, kind, target }) => {
    const { stdout } = await execute(process.execPath, ["--import", "tsx", "tests/sharing-worker.ts", f.filename, actor, f.sheetId, kind, target]);
    const parsed: unknown = JSON.parse(stdout); return parsed;
  }));
}
it("serializes simultaneous invitations and acceptance across separate processes and handles revoke/accept races", async () => {
  const f = fixture();
  expect(await race(f, [1, 2].map(() => ({ actor: f.owner, kind: "invite", target: f.member })))).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  const pending = f.connection.db.select().from(sheetInvites).all(); expect(pending).toHaveLength(1);
  const id = pending[0]?.id; if (!id) throw new Error("Missing invitation.");
  expect(await race(f, [1, 2].map(() => ({ actor: f.member, kind: "accept", target: id })))).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  expect(f.connection.db.select().from(sheetMembers).all()).toHaveLength(1);
  const next = f.invite(f.other);
  const results = await race(f, [{ actor: f.other, kind: "accept", target: next }, { actor: f.owner, kind: "revoke", target: next }]);
  expect(results.filter((result) => result && typeof result === "object" && "ok" in result && result.ok)).toHaveLength(1);
  const record = f.connection.db.select().from(sheetInvites).where(eq(sheetInvites.id, next)).get();
  const membership = f.connection.db.select().from(sheetMembers).where(eq(sheetMembers.userId, f.other)).get();
  expect(Boolean(membership)).toBe(record?.state === "accepted");
}, 20_000);
it("serves session-protected sharing requests and rejects foreign-origin, malformed and oversized mutations", async () => {
  const { connection } = database();
  const config = { origin: "http://localhost:3000", secret: "sharing-secret-with-at-least-thirty-two-characters", setupToken: "sharing-token-with-at-least-thirty-two-characters", registrationEnabled: false };
  await initializeInstance({ name: "Admin", username: "admin", email: "admin@example.test", password: "test-long-password", setupToken: config.setupToken }, config, connection);
  const auth = createAuth(connection, config);
  const response = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "test-long-password" }) }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const actor = connection.db.select().from(user).get(); if (!actor) throw new Error("Missing admin.");
  const recipient = randomUUID(); connection.db.insert(user).values({ id: recipient, name: "Dana", username: "dana", email: "dana@example.test", updatedAt: new Date() }).run();
  const sheetId = createSheet(actor.id, { name: "Sample", currency: "USD" }, connection).sheet.id;
  const dependencies = { auth, connection, origin: config.origin };
  const operation = { kind: "sharing", sheetId } as const;
  function request(body?: string, origin = config.origin, authenticated = true, contentType = "application/json") {
    return new Request(`${config.origin}/api/invites`, { method: body === undefined ? "GET" : "POST", headers: { origin, "content-type": contentType, ...(authenticated ? { cookie } : {}) }, ...(body === undefined ? {} : { body }) });
  }
  expect((await handleSharingRequest(request(undefined, config.origin, false), { kind: "incoming" }, dependencies)).status).toBe(401);
  expect(await (await handleSharingRequest(request(), { kind: "incoming" }, dependencies)).json()).toEqual({ invites: [] });
  expect((await handleSharingRequest(request("{}", "https://foreign.test"), operation, dependencies)).status).toBe(403);
  expect((await handleSharingRequest(request("{}", config.origin, true, "text/plain"), operation, dependencies)).status).toBe(415);
  expect((await handleSharingRequest(request("x".repeat(4097)), operation, dependencies)).status).toBe(413);
  expect((await handleSharingRequest(request("{"), operation, dependencies)).status).toBe(400);
  expect((await handleSharingRequest(request("{}"), operation, dependencies)).status).toBe(400);
  const sent = await handleSharingRequest(request(JSON.stringify({ kind: "invite", userId: recipient })), operation, dependencies);
  expect(sent.status).toBe(200);
  expect(sent.headers.get("cache-control")).toBe("no-store");
  const invite = connection.db.select().from(sheetInvites).get(); if (!invite) throw new Error("Missing invite.");
  expect((await handleSharingRequest(request(JSON.stringify({ kind: "accept" })), { kind: "respond", inviteId: invite.id }, dependencies)).status).toBe(404);
  expect(connection.db.select().from(sheetMembers).all()).toEqual([]);
});
