import { openDatabase } from "../src/db/client";
import { mutateSharing, respondToInvite } from "../src/sharing/service";

const [filename, actor, sheetId, action, target] = process.argv.slice(2);
if (!filename || !actor || !sheetId || !target) throw new Error("Missing race test arguments.");
const connection = openDatabase(filename);
try {
  const result = action === "accept" ? respondToInvite(actor, target, { kind: "accept" }, connection)
    : action === "invite" ? mutateSharing(actor, sheetId, { kind: "invite", userId: target }, connection)
    : mutateSharing(actor, sheetId, { kind: "revokeInvite", inviteId: target }, connection);
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "Unknown failure" }));
} finally { connection.sqlite.close(); }
