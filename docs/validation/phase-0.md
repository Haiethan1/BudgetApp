# Phase 0 validation

## Independent backup and restore validation, October 3, 2026

`pnpm check` passed lint, type checking, all 23 tests, compiled flat operations bundles, and Next standalone build. Tests include native compiled password recovery after the operations-lease change.

`node scripts/docker-restore-drill.mjs` passed on Docker Engine 29.8.1. Its isolated source instance created actual credential-bearing admin/member users, a USD sheet, accepted membership, protected defaults, and a literal foundation record. Online backup succeeded while the application ran. Live restore was refused. Restoring into new target volumes recovered credentials, members, sheets, defaults, and the exact persisted record; the restored old cookie returned 401 and fresh sign-in succeeded. The drill removed only its own UUID-named source/target projects and volumes.

Independent compiled host-command tests used disposable databases under `data/backup-independent-*` and exercised:

- `node operations/backup.mjs create`, `validate`, `export`, and `restore`; existing export destinations were rejected.
- A committed record present in an open WAL database was found with its exact value in the published standalone snapshot.
- Corrupt, future-migration, missing-prefix-migration, and unknown-schema candidates returned nonzero status. SHA-256 hashes of the target database, WAL, and SHM remained unchanged for every rejection.
- Valid restoration over unreadable current database/WAL/SHM preserved each component's exact original bytes in the reported preservation directory and removed stale sidecars from the restored target.
- Compiled startup held a live runtime lease, refused a second startup, and blocked restore. Stale runtime and operations leases also blocked operations instead of being automatically removed.
- A separate process holding startup's runtime lease beat a concurrent restore attempt; restore was refused and the lease was released normally afterward.
- A known one-migration foundation database received a validated `pre-upgrade-*` snapshot containing the original literal record and one-entry migration prefix before startup applied newer migrations.

The actual managed host launcher `node operations/serve.mjs start -p 3127` reached Ready and blocked compiled restore and a competing host launcher. Windows process termination left a stale lease, as expected for non-graceful shutdown. Verified its isolated child was stopped before removing only that disposable database's runtime lease and completing the separate-process race. No household database, lease, container, or volume was modified.

These restore checks cover all real tables currently available in phase 0. Transaction, split, budget, and import identities will require the later release drill once their owning phases implement them. No fake spending tables or production seed records were added. No backup-foundation test failures remain.

### Independent snapshot sidecar repair retest

Eight focused snapshot tests passed after the repair. Rebuilt the actual operations bundles and independently ran canonical `create`, `validate`, `export`, and `restore` successfully.

An independent real writer opened a copied candidate in WAL mode and committed a literal row entirely through WAL while the manifest's main-file checksum stayed unchanged. All three compiled candidate operations, validation, export, and restore, rejected that live bundle. No export destination appeared, and target database/WAL/SHM hashes stayed unchanged. Closing the writer left a two-file bundle with a WAL-format header; validation rejected it without creating sidecars. Individually added `-wal`, `-shm`, and `-journal` files were also rejected before target changes.

The repair changes candidate admission only. Snapshot creation's rollback-format normalization is unchanged and passed the independent canonical command sequence, so the earlier successful fresh-volume Docker drill remains applicable. No targeted regression failures remain.

## Scaffold, issue 4

Scope includes Next.js App Router, TypeScript, Drizzle SQLite migrations, a standalone Docker image, reproducible pnpm commands, and CI.

- Versions are pinned in `package.json` and `pnpm-lock.yaml`. Development, CI, and Docker target Node.js 24 and pnpm 11.19.0.
- Next.js 16.3.8 addresses the published September 30, 2026 security fixes. React 19.1.9 remains compatible. Drizzle 0.45.2 fixes the high-severity identifier-injection advisory found during audit.
- Host commands load Next's environment files. Migration CLI subprocess tests cover Windows file URLs and `.env.local` loading.
- Docker ships production migration dependencies explicitly. Startup applies migrations before starting one application process.
- `node scripts/docker-drill.mjs` creates isolated test volumes, checks fresh startup, writes an operational record, restarts, verifies the exact retained value, and removes its test project.
- No financial fixture data or production users are seeded. The operational foundation record has no financial meaning.

Independent test results and any execution limits are recorded below after development checks.

## Authentication, issue 5

Implemented `/setup`, `/sign-in`, `/register`, direct Better Auth endpoints, a protected session welcome screen, and host/Docker stdin recovery commands. No sheet logic or financial defaults are introduced. Authentication uses the official generated Better Auth 1.7.7 Drizzle schema and username plugin.

Integration tests exercise real migrated SQLite and Better Auth handlers for concurrent bootstrap, rollback, incorrect tokens, foreign/missing origins, registration controls, username requirement, admin-field spoofing, signup races, email/username login, unauthorized/expired sessions, recovery revocation, and the host recovery subprocess. Client IPs are isolated in handler tests so rate limiting does not merge independent test cases.

Auth screens use the specified 420px panels and accessible labels, field errors, announcements, focus, and touch targets. Failed submissions retain identity fields and clear password/setup-token controls. Shared shell components are implemented in issue 8; this issue supplies the actual auth states and styling for later reuse. Actual browser screenshots and independent checks follow in the tester handoff.

### Independent scaffold retest, October 2, 2026

Executed on Windows with Node.js 24.19.0, pnpm 11.19.0, and Docker Engine 29.2.1. The bundled Node and pnpm directories were prepended to `PATH`. Dependency, build, subprocess, and Docker commands ran outside sandbox restrictions with approved escalation.

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed. Lockfile unchanged; dependencies already current. |
| `pnpm lint` | Passed with zero warnings. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | Four tests passed. Includes real migration subprocesses with Windows paths containing spaces and `.env.local`, database pragmas, repeated migration, and reopen persistence. |
| `pnpm build` | Passed. Standalone output completed for `/`, `/_not-found`, and `/api/health`. Previous Windows symlink and ancestor tracing failures did not recur. |
| `node scripts/docker-drill.mjs` | Passed independently using project `homebooks-drill-e0c17edd`. Created fresh data and backup volumes, reached healthy status, wrote UUID `f166cfe3-6b2d-4d36-bdf9-c0fe0664eae0`, restarted, reached healthy status again, and read the exact UUID. Test container, network, and volumes were removed. |

The Docker retest used image `sha256:27771ae7a6a5fa3a71fd3174e15c2674ee4e213dd30cb24755eccad1aba2b38c`; image build layers were cached from the developer's successful build. Fresh runtime volumes and restart checks were independent. Container startup and the persistence command exercised the shipped production Drizzle and SQLite dependencies.

The previous migration CLI and SQL timestamp defects are fixed. No scaffold test failures remain. These checks do not establish authentication, sheet isolation, backup, or restore behavior; those belong to the remaining phase 0 tasks.

### Independent Docker port-conflict regression

Verified the revised drill with a separate Node TCP listener bound to `0.0.0.0:3000` and inherited `HOMEBOOKS_PORT=3000`. Ran `node scripts/docker-drill.mjs` as a child process while that listener remained open. The script overrides its Compose environment to `HOMEBOOKS_PORT=0`, so Docker assigns an available port.

Project `homebooks-drill-fcb10b13` reached healthy status, persisted UUID `cffda158-3908-4f33-8007-69fdf6506d93` across restart, and removed its container, network, and volumes. The child exited successfully; the independent listener was still active afterward and was then closed. This verifies that a running service on the normal household port does not block or get stopped by the drill.

## Authentication, issue 5, independent initial pass

Tested October 2, 2026 against an isolated host database at port 3125 and the isolated Docker Compose project `homebooks-auth-independent` at port 3126. Deterministic credentials and setup tokens were used only for these test instances. Docker test resources were removed after checks. No production users or financial fixtures were seeded.

`pnpm typecheck` passed and `pnpm test` passed all ten tests, including setup races, credential-write rollback, controlled signup, admin-field rejection, session expiry, and source CLI recovery. `pnpm check` failed its initial lint step because the previous build's generated `operations/recover-password.mjs` contained an unused variable warning.

Actual Chrome tests using bundled Playwright verified setup rejection of a wrong token, preservation of identity fields and clearing of secrets after errors, successful setup, email sign-in, uppercase username sign-in, Enter-key submission, first keyboard focus, sign-out, registration validation, successful registration, network-error feedback, direct signup admin spoof rejection, and exactly one successful response from simultaneous duplicate signups. At all tested auth screens, document width did not exceed viewport width at 320px.

The Docker image built successfully and became healthy with fresh volumes. Direct signup was rejected before setup and while registration was disabled. Missing and foreign setup origins were rejected. Concurrent live setup requests returned 201 and 409. Disabled registration explained the host-admin action. The image SHA was `e3ed64270cc3616466d2fc35606aa28a2bda58c7a3bad115bb1dfe5699c8cce2`.

### Failures requiring repair

- Repeatable full-check failure: `pnpm build` generates an operations bundle, then `pnpm check` fails lint on that bundle. Ignore generated operations output in lint.
- Native compiled recovery fails on both Windows and the actual Linux Docker image. `node operations/recover-password.mjs USERNAME` with a new password supplied on stdin exits 1 before changing the password because `@next/env` is CommonJS and does not expose `loadEnvConfig` as a native ESM named export. The source `tsx` test does not detect this deployment failure.
- After a persisted session was expired and window focus triggered the real session watcher, navigation reached `/sign-in?expired=1` but no expired-session message appeared. The form's server-initialized state remains false during hydration. The same missing message appeared when opening that URL directly.
- `pnpm audit --prod --json` reports one critical advisory for Vitest 3.2.4 through `better-auth>vitest`, patched at 3.2.6, and three moderate findings. The Vitest and mocker moderate advisory requires 4.1.11; the esbuild 0.18.20 finding requires 0.24.3. Resolve the dependency graph and verify the report, rather than relying only on an audit command's exit status.

### Actual-app screenshots

Files under `screenshots/` capture the actual app, not the HTML reference. Desktop and phone pairs are available for `auth-setup`, `auth-setup-error`, `auth-sign-in`, `auth-register`, `auth-network-error`, `auth-registration-disabled`, and `auth-expired`, using suffixes `-1440.png` and `-390.png`. `auth-register-validation-320.png` shows field validation. The expired screenshots document the missing status message and are initial failure evidence, not acceptance evidence. Screenshots include no passwords or setup tokens.

### Authentication repair retest

The independent command sequence `pnpm build`, `pnpm check`, and `pnpm audit --prod --audit-level high` passed after repairs. The full check includes eleven passing tests and both native recovery bundle and Next standalone production builds. Production audit now reports zero high or critical findings. Its remaining moderate finding is esbuild 0.18.20 through Better Auth's optional Drizzle Kit tooling peer, concerning that tooling's development server; the app does not start that server.

Built a new image `sha256:fd8d43b4674e189bd4bab1ffd40fd4fa739f9281afbb66a823f5c2f4b5642ff3` and started fresh volumes in project `homebooks-auth-retest`. Actual Docker stdin recovery succeeded without echoing the password, invalidated the existing session, rejected the prior password, and accepted the replacement password. Repeated test sign-ins exercised the configured rate limiter; final credential assertions used separate isolated test client IPs. Removed only the test project's container, volumes, and network afterward.

Actual Chrome checks passed sign-out network rejection, fulfilled HTTP 500, visible retryable error while staying signed in, pending disabled control, and successful retry. Persisted session expiration followed by window focus now redirects to `/sign-in?expired=1` and shows the session-expired status. Rechecked 320px overflow. Replaced `auth-expired-1440.png` and `auth-expired-390.png` with passing screenshots, and added `auth-signout-error-1440.png` and `auth-signout-error-390.png`. The earlier paragraph describing expired screenshots as failure evidence is superseded by these replacements. No authentication test failures remain.

### Independent sheets retest

`pnpm check` passed lint, type checking, sixteen tests, operations build, and Next standalone build. The Docker image `sha256:7f8da22b5570f06f39d4e01547ea8f331027977ec8260aa47f578edabf2bc16a` started healthy with fresh isolated volumes in project `homebooks-sheets-independent`.

Actual Chrome and HTTP tests covered two signed-in users with independently owned sheets. Neither could read or select the other's guessed sheet ID. The instance admin had no access to the ordinary user's sheet. Anonymous reads returned 401; inaccessible authenticated reads and selections returned 404. Foreign-origin creation returned 403. Invalid, malformed, and oversized creation requests returned 400, 400, and 413 respectively. A submitted `ownerId` could not change server-controlled ownership.

Verified one protected Uncategorized category and Unassigned bucket after creation. A deliberate failing bucket-insert trigger made the creation endpoint return 500 and left no partial sheet. Internal membership fixture insertion granted access and selection; deleting it made the next read and selection fail. A stale saved-selection cookie did not expose another user's sheet or name. No membership-transition product endpoints were introduced for this test.

Actual UI checks passed welcome, sheet creation, selection, preservation of name and currency after network failure, disabled create button during a held request, failed switching with successful retry, and unavailable-sheet state without the sheet name. Docker restart preserved both auth users, the sheet's exact name, its defaults, and the usable session. Removed only the isolated test project after checks.

Actual screenshots include desktop and phone pairs `sheets-welcome`, `sheets-create`, `sheets-create-error`, `sheets-selected`, and `sheets-unavailable`, using `-1440.png` and `-390.png`. `sheets-switch-error-1440.png` records retry feedback. All main tested pages passed the 320px document-overflow check. The selected sheet is the intentional foundation screen; spending screens and the full shared shell remain later issues. No sheet-foundation test failures remain.

## Sheets, issue 6

Implemented signed-in no-sheet welcome, `/sheets/new` creation, `/sheets/[sheetId]` selection/view, and protected list/create/read/select APIs. The current UI is the foundation sheet flow; the complete sidebar/navigation/shared components are introduced in issue 8. Financial entry and membership transitions remain in their own later issues. No fixture labels or transactions are seeded.

Sheet creation atomically inserts the owner-authoritative sheet plus protected Uncategorized and Unassigned defaults. USD is initially selected under the confirmed household choice; supported ISO currencies are available. There is no currency-change endpoint. Accepted memberships are unique and exclude the owner through database triggers.

The common access check derives owner/member access from current database rows and ignores admin status. Same-sheet validators cover the category and bucket tables actually available in phase 0; account/transaction validators will extend this boundary when their tables are introduced in phase 1. Composite `(sheet_id, id)` indexes support those future foreign keys.

Integration tests use real Better Auth sessions and migrated SQLite for unauthenticated/guessed-ID/admin denial, actor-forced ownership, protected defaults, invalid input, CSRF rejection, atomic rollback, accepted-member revocation, inaccessible remembered selection, and cross-sheet references even when one actor owns both sheets. Browser and Docker restart evidence follows in independent testing.

## Backup and restore, issue 7

Implemented host and compiled Docker snapshot create/validate/export/restore commands, coordinated startup/runtime and operations leases, and automatic pre-upgrade snapshots for supported older migration prefixes. Restore deletes restored sessions and preserves exact offline target/sidecar bytes even when the target is corrupt. Scheduling, retention, status UI, and browser restore remain deferred.

Developer regression coverage uses actual migrated SQLite, WAL writes, Better Auth credentials/sessions, accepted membership, sheets/defaults, checksum/application/schema rejection with unchanged target bytes, corrupted-target preservation, runtime/operations/stale lease refusal, old-prefix upgrade snapshots, and compiled native ESM CLI subprocesses. The full suite contains 23 tests. Independent checks and the fresh-volume Docker recovery drill are recorded below after handoff; they are not implied by these source tests.
