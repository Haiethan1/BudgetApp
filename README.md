# Homebooks

Self-hosted household spending and category budgets, with family expense attribution. The runnable foundation is in place. Product workflows follow the [MVP tracker](https://github.com/Haiethan1/BudgetApp/issues/2).

## Development

Use Node.js 24 and pnpm 11.19.0. Install pnpm with `npm install --global pnpm@11.19.0` if needed. Native SQLite installation requires Python and a C++ toolchain when a prebuilt binary is unavailable.

```sh
cp .env.example .env.local
# Set DATABASE_URL in .env.local to ./data/homebooks.sqlite for host development.
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Next.js, migration generation, and database host commands load the same `.env` files using Next's environment loader. Exported environment variables take precedence. `.env.local` is intentionally excluded in test mode. Docker uses Compose environment variables instead of copying secret files into its image.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`, or `pnpm check` for all checks. Generate migrations after schema changes with `pnpm db:generate`; commit generated migrations. `pnpm db:migrate` works on Windows and Linux and is safe to repeat. CI also checks production dependencies with `pnpm audit --prod --audit-level high`.

SQLite connections enable foreign keys, WAL, a five-second busy timeout, and normal synchronous writes. Keep the database on local storage, not a network filesystem. Never commit databases, credentials, or real statements.

## Docker

Docker Engine with Compose v2 is required. The image uses the same Node and pnpm versions and frozen lockfile as development and CI. It ships the migration runtime explicitly, applies migrations before starting the server, and runs one app process as an unprivileged user.

```sh
docker compose up --build -d --wait
curl --fail http://localhost:3000/api/health
```

Compose mounts named volumes at `/data` and `/backups`. `/backups` is separate in preparation for snapshot support. Separate volumes on one host do not provide off-host disaster recovery. Set `HOMEBOOKS_PORT` in the shell or a Compose `.env` file to change the published host port. Initial deployment is intended for a private network; restrict access at the host/network boundary.

To verify your running instance retains a harmless operational record across restart:

```sh
docker compose exec -T app node docker/persistence-check.mjs write retained
docker compose restart app
docker compose up -d --wait
docker compose exec -T app node docker/persistence-check.mjs read retained
```

The final command prints `retained` and fails if the value differs. No demo users or financial transactions are seeded.

Run `pnpm docker:drill` for the automated fresh-volume drill. It builds the image, waits for healthy startup, writes a unique record, restarts the app, verifies persistence, and removes only its own uniquely named Compose project and test volumes. CI runs this same drill. Household volumes are untouched.

- [Implementation plan](docs/implementation-plan.md)
- [MVP GitHub issue backlog](docs/issue-backlog.md)
- [Website specification](docs/website-spec.md)
- [Website visual reference](docs/website-reference.html)
- [Editable system diagram](docs/system-design.excalidraw)
- [System diagram preview](docs/system-design-preview.png)

Agent handoffs start with [AGENTS.md](AGENTS.md).
