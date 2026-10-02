import { recoverPassword } from "../src/auth/recovery";
import { getDatabase } from "../src/db/client";

async function main() {
  const identifier = process.argv[2];
  if (!identifier || process.stdin.isTTY) throw new Error("Supply username/email as an argument and the new password on stdin.");
  let password = "";
  for await (const chunk of process.stdin) {
    password += chunk.toString();
    if (password.length > 256) throw new Error("Password input is too long.");
  }
  try {
    await recoverPassword(identifier, password.replace(/\r?\n$/, ""));
    console.log("Password updated. All sessions for this user were revoked.");
  } finally {
    getDatabase().sqlite.close();
  }
}
main().catch(() => { console.error("Recovery failed. Check the user, password rules, and database configuration."); process.exitCode = 1; });
