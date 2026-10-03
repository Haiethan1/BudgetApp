import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const id = randomUUID().slice(0, 8);
const sourceProject = `homebooks-recovery-source-${id}`;
const targetProject = `homebooks-recovery-target-${id}`;
const origin = "http://localhost:3000";
const env = { ...process.env, HOMEBOOKS_PORT: "0", BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "drill-only-auth-secret-with-at-least-thirty-two-characters",
  HOMEBOOKS_SETUP_TOKEN: "drill-only-setup-token-with-at-least-thirty-two-characters", HOMEBOOKS_REGISTRATION_ENABLED: "true" };
function docker(args, expected = 0) {
  const result = spawnSync("docker", args, { env, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== expected) throw new Error(`Docker ${args[0]} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
function compose(project, ...args) { return docker(["compose", "-p", project, ...args]); }
function base(project) {
  const port = compose(project, "port", "app", "3000").split("\n")[0].match(/:(\d+)$/)?.[1];
  if (!port) throw new Error("Could not find the isolated drill port.");
  return `http://localhost:${port}`;
}
async function api(url, endpoint, body, cookie) {
  const response = await fetch(`${url}${endpoint}`, { method: body ? "POST" : "GET",
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Drill request ${endpoint} failed with ${response.status}.`);
  return response;
}
const cookies = (response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
const volumeArgs = ["--volume", `${sourceProject}_homebooks-backups:/snapshot-source:ro`,
  "--volume", `${targetProject}_homebooks-data:/data`, "--volume", `${targetProject}_homebooks-backups:/backups`];
try {
  compose(sourceProject, "up", "--build", "--wait", "--wait-timeout", "180");
  const source = base(sourceProject);
  const password = "drill-test-password";
  await api(source, "/api/setup", { name: "Drill admin", username: "drill_admin", email: "drill-admin@example.test", password, setupToken: env.HOMEBOOKS_SETUP_TOKEN });
  await api(source, "/api/auth/sign-up/email", { name: "Drill member", username: "drill_member", email: "drill-member@example.test", password });
  const login = await api(source, "/api/auth/sign-in/username", { username: "drill_admin", password });
  const cookie = cookies(login);
  const created = await (await api(source, "/api/sheets", { name: "Recovery drill sheet", currency: "USD" }, cookie)).json();
  compose(sourceProject, "exec", "-T", "app", "node", "-e", `const D=require('better-sqlite3');const d=new D(process.env.DATABASE_URL);d.prepare("INSERT INTO sheet_members(sheet_id,user_id,accepted_at) SELECT ?,id,? FROM user WHERE username='drill_member'").run(process.argv[1],Date.now());d.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES('restore-drill','retained',?)").run(Date.now());d.close();`, created.id);
  const snapshot = compose(sourceProject, "exec", "-T", "app", "node", "operations/backup.mjs", "create");
  const refused = docker(["compose", "-p", sourceProject, "exec", "-T", "app", "node", "operations/backup.mjs", "restore", snapshot], 1);
  if (refused) console.log(refused);
  compose(sourceProject, "stop", "app");
  const image = `${sourceProject}-app`;
  const sourceSnapshot = `/snapshot-source/${snapshot.split("/").at(-1)}`;
  docker(["run", "--rm", ...volumeArgs, "--entrypoint", "node", image, "operations/backup.mjs", "restore", sourceSnapshot]);
  docker(["tag", image, `${targetProject}-app`]);
  compose(targetProject, "up", "--no-build", "--wait", "--wait-timeout", "180");
  const target = base(targetProject);
  const expired = await fetch(`${target}/api/sheets`, { headers: { cookie } });
  if (expired.status !== 401) throw new Error("A restored session was still usable.");
  const targetLogin = await api(target, "/api/auth/sign-in/username", { username: "drill_admin", password });
  const restoredCookie = cookies(targetLogin);
  const restored = await (await api(target, `/api/sheets/${created.id}`, undefined, restoredCookie)).json();
  if (restored.name !== "Recovery drill sheet" || restored.categories[0]?.name !== "Uncategorized" || restored.buckets[0]?.name !== "Unassigned") throw new Error("Restored sheet/defaults did not match.");
  const memberLogin = await api(target, "/api/auth/sign-in/username", { username: "drill_member", password });
  const memberSheets = await (await api(target, "/api/sheets", undefined, cookies(memberLogin))).json();
  if (memberSheets.sheets[0]?.id !== created.id || memberSheets.sheets[0]?.role !== "member") throw new Error("Restored membership did not match.");
  const retained = compose(targetProject, "exec", "-T", "app", "node", "-e", `const D=require('better-sqlite3');const d=new D(process.env.DATABASE_URL,{readonly:true});console.log(d.prepare("SELECT value FROM foundation_records WHERE key='restore-drill'").get().value);d.close();`);
  if (retained !== "retained") throw new Error("Restored foundation record did not match.");
  console.log("Fresh-volume Docker recovery drill passed: credentials, members, sheets, defaults, persisted record, and fresh sign-in.");
} finally {
  compose(targetProject, "down", "--volumes", "--remove-orphans");
  compose(sourceProject, "down", "--volumes", "--remove-orphans");
}
