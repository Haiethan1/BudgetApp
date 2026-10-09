import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client";
import { user } from "../db/schema";
export function isInstanceAdmin(userId: string, connection = getDatabase()) {
  return connection.db.select({ admin: user.isInstanceAdmin }).from(user).where(eq(user.id, userId)).get()?.admin === true;
}
