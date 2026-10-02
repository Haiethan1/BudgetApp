import Database from "better-sqlite3";

const [command, value] = process.argv.slice(2);
const sqlite = new Database(process.env.DATABASE_URL ?? "/data/homebooks.sqlite");
try {
  if (command === "write" && value) {
    sqlite.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("docker-persistence-check", value, Date.now());
  } else if (command === "read") {
    const row = sqlite.prepare("SELECT value FROM foundation_records WHERE key=?").get("docker-persistence-check");
    if (!row || (value && row.value !== value)) throw new Error("Persisted record did not match.");
    console.log(row.value);
  } else {
    throw new Error("Usage: node docker/persistence-check.mjs <write VALUE|read [EXPECTED]>");
  }
} finally {
  sqlite.close();
}
