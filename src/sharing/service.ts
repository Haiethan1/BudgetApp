import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ne, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { sharingRateLimits, sheetInvites, sheetMembers, sheets, user } from "../db/schema";
import { readSheet, requireSheetAccess, SheetError } from "../sheets/service";
import { responseInput, searchInput, sharingInput } from "./input";

type Connection = ReturnType<typeof openDatabase>;
export const sharingLimits = { search: { count: 30, windowMs: 60_000 }, invite: { count: 20, windowMs: 3_600_000 } };
function consumeRate(userId: string, kind: keyof typeof sharingLimits, connection: Connection) {
  connection.sqlite.transaction(() => {
    const now = Date.now(); const limit = sharingLimits[kind];
    const key = and(eq(sharingRateLimits.userId, userId), eq(sharingRateLimits.kind, kind));
    const row = connection.db.select().from(sharingRateLimits).where(key).get();
    if (row && now < row.windowStart + limit.windowMs && row.count >= limit.count) throw new SheetError("Too many requests. Try again later.", 429);
    const fresh = !row || now >= row.windowStart + limit.windowMs;
    connection.db.insert(sharingRateLimits).values({ userId, kind, windowStart: now, count: 1 }).onConflictDoUpdate({
      target: [sharingRateLimits.userId, sharingRateLimits.kind], set: { windowStart: fresh ? now : row.windowStart, count: fresh ? 1 : row.count + 1 },
    }).run();
  }).immediate();
}
export function searchInvitees(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId, ownerOnly: true }, connection);
  consumeRate(userId, "search", connection);
  const query = searchInput.parse(input).replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
  return connection.db.select({ id: user.id, name: user.name, username: user.username }).from(user).where(and(
    ne(user.id, userId), sql`${user.name} LIKE ${`%${query}%`} ESCAPE '!'`,
    notExists(connection.db.select().from(sheetMembers).where(and(eq(sheetMembers.sheetId, sheetId), eq(sheetMembers.userId, user.id)))),
    notExists(connection.db.select().from(sheetInvites).where(and(eq(sheetInvites.sheetId, sheetId), eq(sheetInvites.inviteeId, user.id), eq(sheetInvites.state, "pending")))),
  )).orderBy(asc(user.name), asc(user.username), asc(user.id)).limit(20).all();
}
export function readSharing(userId: string, sheetId: string, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId, ownerOnly: true }, connection);
  return { people: readSheet(userId, sheetId, connection).people,
    invites: connection.db.select({ id: sheetInvites.id, inviteeId: user.id, name: user.name, username: user.username, state: sheetInvites.state, createdAt: sheetInvites.createdAt }).from(sheetInvites)
      .innerJoin(user, eq(user.id, sheetInvites.inviteeId)).where(and(eq(sheetInvites.sheetId, sheetId), eq(sheetInvites.state, "pending"))).orderBy(desc(sheetInvites.createdAt)).all() };
}
export function incomingInvites(userId: string, connection: Connection = getDatabase()) {
  return connection.db.select({ id: sheetInvites.id, sheetId: sheets.id, sheetName: sheets.name, inviterName: user.name, inviterUsername: user.username, state: sheetInvites.state, createdAt: sheetInvites.createdAt }).from(sheetInvites)
    .innerJoin(sheets, eq(sheets.id, sheetInvites.sheetId)).innerJoin(user, eq(user.id, sheetInvites.inviterId))
    .where(and(eq(sheetInvites.inviteeId, userId), eq(sheetInvites.state, "pending"))).orderBy(desc(sheetInvites.createdAt)).all();
}
export function mutateSharing(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = sharingInput.parse(input);
  // Count invite attempts even when the operation fails or is retried.
  requireSheetAccess({ userId, sheetId, ownerOnly: parsed.kind !== "leave" }, connection);
  if (parsed.kind === "invite") consumeRate(userId, "invite", connection);
  return connection.sqlite.transaction(() => {
    const access = requireSheetAccess({ userId, sheetId, ownerOnly: parsed.kind !== "leave" }, connection);
    const now = new Date();
    switch (parsed.kind) {
      case "invite": {
        if (parsed.userId === access.sheet.ownerId || connection.db.select().from(sheetMembers).where(and(eq(sheetMembers.sheetId, sheetId), eq(sheetMembers.userId, parsed.userId))).get()) throw new SheetError("This person already has access.", 409);
        if (!connection.db.select({ id: user.id }).from(user).where(eq(user.id, parsed.userId)).get()) throw new SheetError("This person is unavailable. Search again.", 404);
        const pending = connection.db.select().from(sheetInvites).where(and(eq(sheetInvites.sheetId, sheetId), eq(sheetInvites.inviteeId, parsed.userId), eq(sheetInvites.state, "pending"))).get();
        if (pending) return { id: pending.id, state: pending.state };
        const id = randomUUID();
        connection.db.insert(sheetInvites).values({ id, sheetId, inviterId: userId, inviteeId: parsed.userId, state: "pending", createdAt: now, updatedAt: now }).run();
        return { id, state: "pending" as const };
      }
      case "revokeInvite": {
        const invite = connection.db.select().from(sheetInvites).where(and(eq(sheetInvites.id, parsed.inviteId), eq(sheetInvites.sheetId, sheetId))).get();
        if (!invite) throw new SheetError("This invitation is unavailable.", 404);
        if (invite.state === "revoked") return { id: invite.id, state: invite.state };
        if (invite.state !== "pending") throw new SheetError("This invitation has already been answered. Reload people.", 409);
        connection.db.update(sheetInvites).set({ state: "revoked", updatedAt: now }).where(eq(sheetInvites.id, invite.id)).run();
        return { id: invite.id, state: "revoked" as const };
      }
      case "removeMember":
      case "leave": {
        const target = parsed.kind === "leave" ? userId : parsed.userId;
        if (target === access.sheet.ownerId) throw new SheetError("The owner cannot leave or be removed. Delete the sheet instead.", 400);
        connection.db.delete(sheetMembers).where(and(eq(sheetMembers.sheetId, sheetId), eq(sheetMembers.userId, target))).run();
        return { removed: true };
      }
    }
  }).immediate();
}
export function respondToInvite(userId: string, inviteId: string, input: unknown, connection: Connection = getDatabase()) {
  const id = z.uuid().parse(inviteId); const { kind } = responseInput.parse(input);
  return connection.sqlite.transaction(() => {
    const invite = connection.db.select().from(sheetInvites).where(and(eq(sheetInvites.id, id), eq(sheetInvites.inviteeId, userId))).get();
    if (!invite) throw new SheetError("This invitation is unavailable.", 404);
    const sheet = connection.db.select().from(sheets).where(eq(sheets.id, invite.sheetId)).get();
    if (!sheet || sheet.ownerId !== invite.inviterId) throw new SheetError("This invitation is unavailable.", 404);
    const targetState = kind === "accept" ? "accepted" : "declined";
    if (invite.state === targetState) {
      if (kind === "accept" && !connection.db.select().from(sheetMembers).where(and(eq(sheetMembers.sheetId, invite.sheetId), eq(sheetMembers.userId, userId))).get()) throw new SheetError("You no longer have access. Ask the owner for a new invitation.", 409);
      return { sheetId: invite.sheetId, state: invite.state };
    }
    if (invite.state !== "pending") throw new SheetError("This invitation is no longer pending.", 409);
    if (kind === "accept") connection.db.insert(sheetMembers).values({ sheetId: invite.sheetId, userId, acceptedAt: new Date() }).onConflictDoNothing().run();
    connection.db.update(sheetInvites).set({ state: targetState, updatedAt: new Date() }).where(eq(sheetInvites.id, invite.id)).run();
    return { sheetId: invite.sheetId, state: targetState };
  }).immediate();
}
