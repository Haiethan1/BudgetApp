import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { openDatabase } from "../db/client";
import { buckets } from "../db/schema";
import { organizationName } from "../sheets/settings-input";

export function ensureDebtSpendingGroup(sheetId: string, input: string, c: ReturnType<typeof openDatabase>) {
  const name = organizationName.parse(input);
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US");
  const existing = c.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).all().find(g => normalize(g.name) === normalize(name));
  if (existing) return existing.name;
  c.db.insert(buckets).values({ id: randomUUID(), sheetId, name }).run();
  return name;
}
