import { eq } from "drizzle-orm";

import { openDatabase } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";
import { foundationRecords } from "../src/db/schema";

const [command, value] = process.argv.slice(2);
const filename = process.env.DATABASE_URL;

migrateDatabase(filename);
const connection = openDatabase(filename);

try {
  if (command === "write") {
    if (!value) throw new Error("Usage: pnpm db:persistence-check write <value>");
    connection.db
      .insert(foundationRecords)
      .values({ key: "docker-persistence-check", value })
      .onConflictDoUpdate({
        target: foundationRecords.key,
        set: { value },
      })
      .run();
    console.log(`Wrote persistence check value: ${value}`);
  } else if (command === "read") {
    const row = connection.db
      .select()
      .from(foundationRecords)
      .where(eq(foundationRecords.key, "docker-persistence-check"))
      .get();
    if (!row) throw new Error("No persistence check record exists.");
    if (value && row.value !== value) throw new Error("Persisted value did not match.");
    console.log(row.value);
  } else {
    throw new Error("Usage: pnpm db:persistence-check <write VALUE|read [EXPECTED]>");
  }
} finally {
  connection.sqlite.close();
}
