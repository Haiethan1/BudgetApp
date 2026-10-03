import { recoverPassword } from "../src/auth/recovery";
import { defaultDatabaseUrl, getDatabase } from "../src/db/client";
import { acquireLease } from "../src/operations/lease";

async function main() {
  const identifier = process.argv[2];
  if (!identifier || process.stdin.isTTY) throw new Error("Supply username/email as an argument and the new password on stdin.");
  let password = "";
  for await (const chunk of process.stdin) {
    password += chunk.toString();
    if (password.length > 256) throw new Error("Password input is too long.");
  }
  const lease = acquireLease(process.env.DATABASE_URL ?? defaultDatabaseUrl, "operations");
  try {
    await recoverPassword(identifier, password.replace(/\r?\n$/, ""));
    console.log("Password updated. All sessions for this user were revoked.");
  } finally {
    try { getDatabase().sqlite.close(); }
    finally { lease.release(); }
  }
}
main().catch(() => { console.error("Recovery failed. Check the user, password rules, and database configuration."); process.exitCode = 1; });
