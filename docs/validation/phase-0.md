# Phase 0 validation

## Scaffold, issue 4

Scope includes Next.js App Router, TypeScript, Drizzle SQLite migrations, a standalone Docker image, reproducible pnpm commands, and CI.

- Versions are pinned in `package.json` and `pnpm-lock.yaml`. Development, CI, and Docker target Node.js 24 and pnpm 11.19.0.
- Next.js 16.3.8 addresses the published September 30, 2026 security fixes. React 19.1.9 remains compatible. Drizzle 0.45.2 fixes the high-severity identifier-injection advisory found during audit.
- Host commands load Next's environment files. Migration CLI subprocess tests cover Windows file URLs and `.env.local` loading.
- Docker ships production migration dependencies explicitly. Startup applies migrations before starting one application process.
- `node scripts/docker-drill.mjs` creates isolated test volumes, checks fresh startup, writes an operational record, restarts, verifies the exact retained value, and removes its test project.
- No financial fixture data or production users are seeded. The operational foundation record has no financial meaning.

Independent test results and any execution limits are recorded below after development checks.

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
