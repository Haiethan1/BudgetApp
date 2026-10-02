import { hashPassword } from "better-auth/crypto";
import { and, eq, or } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { account, session, user } from "../db/schema";
import { passwordSchema } from "./identity";

export async function recoverPassword(identifier: string, input: string, connection: ReturnType<typeof openDatabase> = getDatabase()) {
  const password = passwordSchema.parse(input);
  const found = connection.db.select().from(user).where(or(eq(user.email, identifier.toLowerCase()), eq(user.username, identifier.toLowerCase()))).get();
  if (!found) throw new Error("No matching user.");
  const hash = await hashPassword(password);
  connection.sqlite.transaction(() => {
    const updated = connection.db.update(account).set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, found.id), eq(account.providerId, "credential"))).run();
    if (updated.changes !== 1) throw new Error("Expected exactly one password credential.");
    connection.db.delete(session).where(eq(session.userId, found.id)).run();
  }).immediate();
}
