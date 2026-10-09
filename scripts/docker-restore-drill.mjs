import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const id = randomUUID().slice(0, 8);
const sourceProject = `homebooks-recovery-source-${id}`;
const targetProject = `homebooks-recovery-target-${id}`;
const origin = "http://localhost:3000";
const password = "drill-only-household-password";
const env = { ...process.env, HOMEBOOKS_PORT: "0", BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), HOMEBOOKS_SETUP_TOKEN: randomBytes(32).toString("hex"), HOMEBOOKS_REGISTRATION_ENABLED: "true" };
let image;
let cleanupAllowed = false;
const projects = [targetProject, sourceProject];
const volumes = projects.flatMap((project) => [`${project}_homebooks-data`, `${project}_homebooks-backups`]);

function docker(args, expected = 0) {
  const result = spawnSync("docker", args, { env, encoding: "utf8", timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `Docker ${args[0]} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
function compose(project, ...args) { return docker(["compose", "-p", project, ...args]); }
function base(project) {
  const port = compose(project, "port", "app", "3000").split("\n")[0].match(/:(\d+)$/)?.[1];
  assert.ok(port, "Could not find the isolated drill port.");
  return `http://localhost:${port}`;
}
function offline(project, code, ...args) {
  return docker(["run", "--rm", "--volume", `${project}_homebooks-data:/data`, "--volume", `${project}_homebooks-backups:/backups`,
    "--volume", `${sourceProject}_homebooks-backups:/snapshot-source:ro`, "--entrypoint", "node", image, "-e", code, ...args]);
}
function restore(directory, expected = 0) {
  return docker(["run", "--rm", "--volume", `${targetProject}_homebooks-data:/data`, "--volume", `${targetProject}_homebooks-backups:/backups`,
    "--volume", `${sourceProject}_homebooks-backups:/snapshot-source:ro`, "--entrypoint", "node", image, "operations/backup.mjs", "restore", directory], expected);
}
async function request(url, endpoint, { body, cookie, method = body ? "POST" : "GET", status = 200, retryRateLimit = false } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(`${url}${endpoint}`, { method, signal: AbortSignal.timeout(30_000),
    headers: { origin, ...(multipart ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
  if (response.status === 429 && retryRateLimit) {
    const seconds = Number(response.headers.get("X-Retry-After"));
    assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 60, "Auth retry delay must be bounded and explicit.");
    console.log(`Auth rate limit observed; waiting ${seconds} seconds before retry.`);
    await delay(Math.min(seconds * 1000 + 250, 60_000));
    return request(url, endpoint, { body, cookie, method, status });
  }
  assert.equal(response.status, status, `Drill request ${endpoint}: ${await response.clone().text()}`);
  return response;
}
async function json(url, endpoint, options) { return (await request(url, endpoint, options)).json(); }
async function login(url, username) {
  const response = await request(url, "/api/auth/sign-in/username", { body: { username, password }, retryRateLimit: true });
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie, "Sign-in must return a session cookie.");
  return cookie;
}
const databaseStateCode = `
  const D=require('better-sqlite3'),{createHash}=require('node:crypto');
  const d=new D(process.argv[1]||process.env.DATABASE_URL,{readonly:true,fileMustExist:true});
  const tables=['sheets','financial_accounts','categories','buckets','transactions','splits','budgets',
    'sheet_members','sheet_invites','import_profiles','import_batches','import_rows','transaction_sources','user','account'];
  const state={};for(const table of tables){const rows=d.prepare('SELECT * FROM '+table).all().map(JSON.stringify).sort();
    state[table]={count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}
  const sessions=d.prepare('SELECT count(*) AS n FROM session').get().n;
  const integrity=d.pragma('integrity_check',{simple:true}),foreignKeys=d.pragma('foreign_key_check');
  d.close();console.log(JSON.stringify({state,sessions,integrity,foreignKeys}));`;
function liveState(project) { return JSON.parse(compose(project, "exec", "-T", "app", "node", "-e", databaseStateCode)); }
function verifyState(actual, expected) {
  assert.equal(actual.integrity, "ok");
  assert.deepEqual(actual.foreignKeys, []);
  assert.deepEqual(actual.state, expected.state, "Recovered domain and auth records must match every stored field.");
}
async function review(url, sheetId, accountId, cookie) {
  const mapping = { version: 1, profile: "Recovery synthetic CSV", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".",
    money: { mode: "signed", amount: "Amount", outflowSign: "negative" } };
  const form = new FormData();
  form.set("file", new File(["Date,Payee,Amount\n2026-11-01,Identical recovery purchase,-10.00\n2026-11-01,Identical recovery purchase,-10.00\n2026-11-02,Recovery refund,2.00\n"], "synthetic-recovery.csv", { type: "text/csv" }));
  form.set("accountId", accountId); form.set("mapping", JSON.stringify(mapping));
  return json(url, `/api/sheets/${sheetId}/imports`, { body: form, cookie });
}
async function verifyMoney(url, sheetId, cookie) {
  const overview = await json(url, `/api/sheets/${sheetId}/overview?month=2026-10`, { cookie });
  const budgets = await json(url, `/api/sheets/${sheetId}/budgets?month=2026-10`, { cookie });
  for (const value of [overview, budgets]) {
    assert.equal(value.total, 27800); assert.equal(value.uncategorized, 1850);
    assert.equal(value.budgetedSpent, 25950); assert.equal(value.totalLimits, 41000); assert.equal(value.remaining, 15050);
    assert.deepEqual(Object.fromEntries(value.rows.map((row) => [row.name, [row.spent, row.limit, row.remaining]])), {
      Groceries: [8000, 15000, 7000], Utilities: [12000, 10000, -2000], Dining: [2450, 10000, 7550], Transport: [3500, 6000, 2500], Uncategorized: [1850, null, null] });
  }
  assert.deepEqual(Object.fromEntries(overview.attribution.map((bucket) => [bucket.name, bucket.spent])), { Ethan: 16950, Parents: 9000, Unassigned: 1850 });
  const november = await json(url, `/api/sheets/${sheetId}/overview?month=2026-11`, { cookie });
  assert.equal(november.total, 1000, "Edited purchase, deleted duplicate, and refund must survive recovery.");
}

try {
  const existingVolumes = new Set(docker(["volume", "ls", "--format", "{{.Name}}"]).split("\n"));
  for (const volume of volumes) assert.ok(!existingVolumes.has(volume), `Drill volume already exists: ${volume}`);
  for (const project of projects) {
    assert.equal(docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]), "", `Drill project already has containers: ${project}`);
    assert.equal(docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]), "", `Drill project already has networks: ${project}`);
  }
  cleanupAllowed = true;
  console.log("Starting isolated family recovery drill.");
  console.log(`Drill projects: ${sourceProject}, ${targetProject}`);
  if (process.env.HOMEBOOKS_DRILL_IMAGE) {
    image = docker(["image", "inspect", "--format", "{{.Id}}", process.env.HOMEBOOKS_DRILL_IMAGE]);
    docker(["tag", image, `${sourceProject}-app`]);
    compose(sourceProject, "up", "--no-build", "--wait", "--wait-timeout", "180");
  } else {
    compose(sourceProject, "up", "--build", "--wait", "--wait-timeout", "180");
    image = docker(["image", "inspect", "--format", "{{.Id}}", `${sourceProject}-app`]);
  }
  console.log(`Recovery image: ${image}`);
  let source = base(sourceProject);
  await request(source, "/api/setup", { body: { name: "Recovery admin", username: "drill_admin", email: "recovery-admin@example.test", password, setupToken: env.HOMEBOOKS_SETUP_TOKEN }, status: 201 });
  const users = {};
  for (const role of ["member", "pending", "revoked"]) {
    const signedUp = await json(source, "/api/auth/sign-up/email", { body: { name: `Recovery ${role}`, username: `drill_${role}`, email: `recovery-${role}@example.test`, password } });
    users[role] = signedUp.user.id;
  }
  const ownerCookie = await login(source, "drill_admin"), memberCookie = await login(source, "drill_member"), revokedCookie = await login(source, "drill_revoked");
  const sheet = await json(source, "/api/sheets", { body: { name: "Recovery Family", currency: "USD" }, cookie: ownerCookie, status: 201 });
  const sheetPath = `/api/sheets/${sheet.id}`;
  const privateSheet = await json(source, "/api/sheets", { body: { name: "Member private sheet", currency: "USD" }, cookie: memberCookie, status: 201 });
  const invited = await json(source, `${sheetPath}/sharing`, { body: { kind: "invite", userId: users.member }, cookie: ownerCookie });
  await json(source, `/api/invites/${invited.id}`, { body: { kind: "accept" }, cookie: memberCookie });
  await json(source, `/api/invites/${invited.id}`, { body: { kind: "accept" }, cookie: memberCookie });
  const pending = await json(source, `${sheetPath}/sharing`, { body: { kind: "invite", userId: users.pending }, cookie: ownerCookie });
  const former = await json(source, `${sheetPath}/sharing`, { body: { kind: "invite", userId: users.revoked }, cookie: ownerCookie });
  await json(source, `/api/invites/${former.id}`, { body: { kind: "accept" }, cookie: revokedCookie });
  await json(source, `${sheetPath}/sharing`, { body: { kind: "removeMember", userId: users.revoked }, cookie: ownerCookie });
  const revoked = await json(source, `${sheetPath}/sharing`, { body: { kind: "invite", userId: users.revoked }, cookie: ownerCookie });
  await json(source, `${sheetPath}/sharing`, { body: { kind: "revokeInvite", inviteId: revoked.id }, cookie: ownerCookie });
  for (const [entity, name, sourceType] of [["account", "Checking", "bank"], ["account", "Visa", "credit_card"], ["category", "Groceries"], ["category", "Utilities"],
    ["category", "Dining"], ["category", "Transport"], ["bucket", "Ethan"], ["bucket", "Parents"]]) {
    await json(source, `${sheetPath}/settings`, { body: { kind: "create", entity, name, ...(sourceType ? { sourceType } : {}) }, cookie: ownerCookie });
  }
  const organization = await json(source, sheetPath, { cookie: ownerCookie });
  const names = (records) => Object.fromEntries(records.map((record) => [record.name, record.id]));
  const accounts = names(organization.accounts), categories = names(organization.categories), buckets = names(organization.buckets);
  const transaction = (date, payee, account, kind, amount, category, allocations) => ({ date: `2026-10-${date}`, payee, accountId: accounts[account], kind, amount,
    splits: allocations.map(([bucket, value]) => ({ categoryId: categories[category], bucketId: buckets[bucket], amount: value })) });
  const entries = [transaction("04", "Market purchase", "Visa", "expense", "-100.00", "Groceries", [["Ethan", "-60.00"], ["Parents", "-40.00"]]),
    transaction("06", "Market refund", "Visa", "refund", "20.00", "Groceries", [["Ethan", "20.00"]]),
    transaction("08", "Electricity", "Checking", "expense", "-120.00", "Utilities", [["Ethan", "-70.00"], ["Parents", "-50.00"]]),
    transaction("10", "Lunch", "Visa", "expense", "-24.50", "Dining", [["Ethan", "-24.50"]]), transaction("11", "Fuel", "Visa", "expense", "-35.00", "Transport", [["Ethan", "-35.00"]]),
    transaction("12", "Unreviewed purchase", "Visa", "expense", "-18.50", "Uncategorized", [["Unassigned", "-18.50"]]),
    transaction("13", "Card payment", "Checking", "transfer", "-100.00", "Uncategorized", [["Unassigned", "-100.00"]]),
    transaction("01", "Paycheck", "Checking", "income", "2000.00", "Uncategorized", [["Unassigned", "2000.00"]])];
  for (const body of entries) await json(source, `${sheetPath}/transactions`, { body, cookie: memberCookie, status: 201 });
  for (const [name, amount] of [["Groceries", "150.00"], ["Utilities", "100.00"], ["Dining", "100.00"], ["Transport", "60.00"]]) {
    await json(source, `${sheetPath}/budgets`, { body: { kind: "save", categoryId: categories[name], month: "2026-10", version: 0, amount }, cookie: memberCookie });
  }
  let imported = await review(source, sheet.id, accounts.Visa, ownerCookie);
  for (const row of imported.rows) imported = await json(source, `${sheetPath}/imports/${imported.id}`, {
    body: { version: imported.version, rowId: row.id, decision: "keep", kindReviewed: true }, cookie: ownerCookie, method: "PATCH" });
  const confirmed = await json(source, `${sheetPath}/imports/${imported.id}/confirm`, { body: { version: imported.version }, cookie: ownerCookie });
  assert.equal(confirmed.kind, "committed"); assert.equal(confirmed.review.result.added, 3);
  const importedIds = confirmed.review.result.transactionIds;
  const edited = await json(source, `${sheetPath}/transactions/${importedIds[0]}`, { cookie: ownerCookie });
  await json(source, `${sheetPath}/transactions/${edited.id}`, { method: "PUT", body: { accountId: edited.accountId, date: edited.date,
    payee: "Edited recovery purchase", kind: "expense", amount: "-12.00", version: edited.version,
    splits: [{ categoryId: categories.Uncategorized, bucketId: buckets.Unassigned, amount: "-12.00" }] }, cookie: ownerCookie });
  await json(source, `${sheetPath}/transactions/${importedIds[1]}`, { method: "DELETE", body: { version: 1 }, cookie: ownerCookie });
  const repeated = await review(source, sheet.id, accounts.Visa, ownerCookie);
  const repeatResult = await json(source, `${sheetPath}/imports/${repeated.id}/confirm`, { body: { version: repeated.version }, cookie: ownerCookie });
  assert.equal(repeatResult.review.result.added, 0); assert.equal(repeatResult.review.result.skipped, 3);
  await verifyMoney(source, sheet.id, ownerCookie);
  const expected = liveState(sourceProject);
  assert.equal(expected.state.transactions.count, 11); assert.equal(expected.state.splits.count, 13);
  assert.equal(expected.state.transaction_sources.count, 3); assert.equal(expected.state.sheet_members.count, 1); assert.equal(expected.state.sheet_invites.count, 4);
  assert.ok(expected.sessions > 0);

  console.log("Family fixture and exact money verified; restarting for populated daily catch-up.");
  compose(sourceProject, "stop", "app");
  // Preserve the empty startup bundle, then let the real scheduler create a populated daily bundle.
  offline(sourceProject, `const f=require('node:fs'),p=require('node:path');for(const e of f.readdirSync('/backups'))
    if(e.startsWith('daily-'))f.renameSync(p.join('/backups',e),p.join('/backups','drill-initial-'+e));`);
  compose(sourceProject, "up", "--no-build", "--wait", "--wait-timeout", "180");
  source = base(sourceProject);
  verifyState(liveState(sourceProject), expected); await verifyMoney(source, sheet.id, ownerCookie);
  const snapshot = compose(sourceProject, "exec", "-T", "app", "node", "-e", `const f=require('node:fs'),p=require('node:path');
    const names=f.readdirSync('/backups').filter(n=>n.startsWith('daily-'));if(names.length!==1)throw Error('Expected one populated daily snapshot');console.log(p.join('/backups',names[0]));`);
  compose(sourceProject, "exec", "-T", "app", "node", "operations/backup.mjs", "validate", snapshot);
  const snapshotState = JSON.parse(compose(sourceProject, "exec", "-T", "app", "node", "-e", databaseStateCode, `${snapshot}/database.sqlite`));
  verifyState(snapshotState, expected); assert.ok(snapshotState.sessions > 0, "Daily bundle must contain sessions before restore.");
  const status = await json(source, "/api/admin/backups", { cookie: ownerCookie });
  assert.equal(status.kind, "available");
  assert.equal(status.lastCheck, "succeeded", "Admin status must report populated daily success.");
  compose(sourceProject, "exec", "-T", "app", "node", "operations/backup.mjs", "export", snapshot, "/backups/drill-export");
  compose(sourceProject, "exec", "-T", "app", "node", "operations/backup.mjs", "validate", "/backups/drill-export");
  docker(["compose", "-p", sourceProject, "exec", "-T", "app", "node", "operations/backup.mjs", "restore", snapshot], 1);
  compose(sourceProject, "stop", "app");
  const sourceSnapshot = `/snapshot-source/${snapshot.split("/").at(-1)}`;
  assert.equal(offline(targetProject, "console.log(require('node:fs').existsSync('/data/homebooks.sqlite'))"), "false", "Target data volume must be fresh.");
  console.log("Restoring populated daily snapshot into fresh volumes.");
  const firstRestore = JSON.parse(restore(sourceSnapshot)); assert.equal(firstRestore.preserved, undefined);
  const firstState = JSON.parse(offline(targetProject, databaseStateCode)); verifyState(firstState, expected); assert.equal(firstState.sessions, 0);
  assert.equal(offline(targetProject, "console.log(require('node:fs').readdirSync('/data').some(n=>/sqlite-(wal|shm)$/.test(n)))"), "false");
  docker(["tag", image, `${targetProject}-app`]);
  compose(targetProject, "up", "--no-build", "--wait", "--wait-timeout", "180");
  const target = base(targetProject);
  for (const cookie of [ownerCookie, memberCookie, revokedCookie]) await request(target, "/api/sheets", { cookie, status: 401 });
  const restoredOwner = await login(target, "drill_admin"), restoredMember = await login(target, "drill_member");
  const restoredPending = await login(target, "drill_pending"), restoredRevoked = await login(target, "drill_revoked");
  await request(target, "/api/setup", { body: { name: "Another admin", username: "another_admin", email: "another@example.test", password, setupToken: env.HOMEBOOKS_SETUP_TOKEN }, status: 409 });
  await verifyMoney(target, sheet.id, restoredOwner); await verifyMoney(target, sheet.id, restoredMember);
  await request(target, sheetPath, { cookie: restoredPending, status: 404 }); await request(target, sheetPath, { cookie: restoredRevoked, status: 404 });
  await request(target, `/api/sheets/${privateSheet.id}`, { cookie: restoredOwner, status: 404 });
  await request(target, `${sheetPath}/sharing`, { body: { kind: "invite", userId: users.pending }, cookie: restoredMember, status: 403 });
  await request(target, "/api/admin/backups", { cookie: restoredMember, status: 403 });
  assert.deepEqual((await json(target, "/api/invites", { cookie: restoredPending })).invites.map((invite) => invite.id), [pending.id]);
  await request(target, `/api/invites/${revoked.id}`, { body: { kind: "accept" }, cookie: restoredRevoked, status: 409 });
  const afterRestoreReview = await review(target, sheet.id, accounts.Visa, restoredOwner);
  const afterRestoreResult = await json(target, `${sheetPath}/imports/${afterRestoreReview.id}/confirm`, { body: { version: afterRestoreReview.version }, cookie: restoredOwner });
  assert.equal(afterRestoreResult.review.result.added, 0); assert.equal(afterRestoreResult.review.result.skipped, 3);
  assert.equal(liveState(targetProject).state.transactions.count, 11);
  const previousSheet = await json(target, "/api/sheets", { body: { name: "Prior restore preservation", currency: "USD" }, cookie: restoredOwner, status: 201 });
  assert.ok(previousSheet.id);
  compose(targetProject, "stop", "app");

  console.log("Checking corrupt and incompatible rejection, prior preservation, and offline sidecars.");
  const offlineComponentsCode = `const f=require('node:fs'),{createHash}=require('node:crypto');const out={};
    for(const s of ['','-wal','-shm','-journal'])if(f.existsSync('/data/homebooks.sqlite'+s))out['database.sqlite'+s]=createHash('sha256').update(f.readFileSync('/data/homebooks.sqlite'+s)).digest('hex');console.log(JSON.stringify(out));`;
  // Orphan sidecars are synthetic and created only after the target server is stopped.
  offline(targetProject, "const f=require('node:fs');f.writeFileSync('/data/homebooks.sqlite-wal','drill-only-stale-wal');f.writeFileSync('/data/homebooks.sqlite-shm','drill-only-stale-shm');");
  const before = JSON.parse(offline(targetProject, offlineComponentsCode));
  for (const kind of ["corrupt", "incompatible"]) {
    const directory = `/backups/drill-${kind}`;
    offline(targetProject, `const f=require('node:fs'),p=require('node:path'),{createHash}=require('node:crypto');
      f.cpSync(process.argv[1],process.argv[2],{recursive:true});const file=p.join(process.argv[2],'database.sqlite');
      if(process.argv[3]==='corrupt')f.writeFileSync(file,'drill-only-corrupt-candidate');
      else{const D=require('better-sqlite3'),d=new D(file);d.exec('CREATE TABLE unsupported_drill_schema(value TEXT)');d.close();
        const m=p.join(process.argv[2],'manifest.json'),v=JSON.parse(f.readFileSync(m,'utf8'));v.databaseDigest=createHash('sha256').update(f.readFileSync(file)).digest('hex');f.writeFileSync(m,JSON.stringify(v));}`, sourceSnapshot, directory, kind);
    restore(directory, 1);
    assert.deepEqual(JSON.parse(offline(targetProject, offlineComponentsCode)), before, `${kind} restore changed prior database components.`);
  }
  const replacement = JSON.parse(restore(sourceSnapshot)); assert.ok(replacement.preserved?.startsWith("/backups/preserved-before-restore-"));
  const preserved = JSON.parse(offline(targetProject, `const f=require('node:fs'),p=require('node:path'),{createHash}=require('node:crypto');
    const root=process.argv[1],m=JSON.parse(f.readFileSync(p.join(root,'preservation.json'),'utf8')),out={};
    for(const c of m.components){const sum=createHash('sha256').update(f.readFileSync(p.join(root,c.name))).digest('hex');if(sum!==c.digest)throw Error('Preservation manifest checksum mismatch');out[c.name]=sum;}console.log(JSON.stringify(out));`, replacement.preserved));
  assert.deepEqual(preserved, before, "Successful restore must preserve all prior components exactly.");
  assert.equal(offline(targetProject, "console.log(require('node:fs').readdirSync('/data').some(n=>/sqlite-(wal|shm)$/.test(n)))"), "false");
  const finalState = JSON.parse(offline(targetProject, databaseStateCode)); verifyState(finalState, expected); assert.equal(finalState.sessions, 0);
  compose(targetProject, "up", "--no-build", "--wait", "--wait-timeout", "180");
  const finalTarget = base(targetProject);
  await request(finalTarget, "/api/sheets", { cookie: restoredOwner, status: 401 });
  await verifyMoney(finalTarget, sheet.id, await login(finalTarget, "drill_admin"));
  console.log("Family recovery assertions passed; removing generated test resources.");
} finally {
  if (cleanupAllowed) {
    for (const project of projects) {
      try { compose(project, "down", "--volumes", "--remove-orphans"); }
      catch (error) { console.error(`Could not clean isolated project ${project}: ${error.message}`); process.exitCode = 1; }
    }
    // Offline docker run can create volumes without Compose labels. Their exact names were absent before this run.
    for (const volume of volumes) {
      try {
        const remaining = new Set(docker(["volume", "ls", "--format", "{{.Name}}"]).split("\n"));
        if (remaining.has(volume)) docker(["volume", "rm", volume]);
      } catch (error) { console.error(`Could not remove generated volume ${volume}: ${error.message}`); process.exitCode = 1; }
    }
    try {
      const remaining = new Set(docker(["volume", "ls", "--format", "{{.Name}}"]).split("\n"));
      for (const volume of volumes) assert.ok(!remaining.has(volume), `Generated volume remains after cleanup: ${volume}`);
    } catch (error) { console.error(`Could not verify generated volume cleanup: ${error.message}`); process.exitCode = 1; }
  }
}
if (!process.exitCode) console.log(`Family Docker recovery drill passed with ${image}: restart, daily catch-up, exact money, domain records, sessions, permissions, repeat import, rejection, preservation, and cleanup.`);
