# Deploy and recover Homebooks

The household chose its UGREEN NAS running UgreenOS/Linux Docker, LAN access, default named volumes, and Ethan as the recovery operator. Ethan will pull encrypted archives onto a Windows PC. Record the actual NAS address and directories in protected operator records; `NAS-LAN-IP` and `REPLACE_...` values below are placeholders. These commands do not provision those locations. See [household inputs](household-inputs.md).

The NAS commands use a Linux shell over SSH, Docker Engine, and Compose v2. Enable the NAS Docker application and operator SSH access, then check `docker version` and `docker compose version`. The operator needs permission to run Docker. No host Node installation is required for deployment. Source checks and the isolated development drills require Node.js 24 and pnpm 11.19.0. Keep one Homebooks instance per database. Store SQLite on local Docker storage. Do not put `/data` on a network filesystem or run multiple replicas.

## Configure the host and secrets

Check out the reviewed release in a persistent operator-owned directory. Protect the directory and its configuration:

```sh
umask 077
cp .env.example .env
chmod 600 .env
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the first generated value in `BETTER_AUTH_SECRET` and the second in `HOMEBOOKS_SETUP_TOKEN`. Keep the auth secret stable and store a recoverable copy in protected operator storage. Keep secrets out of Git, image layers, shell arguments, and backup-transfer directories.

Set these entries in `.env` for direct private-network access:

```dotenv
COMPOSE_PROJECT_NAME=homebooks
HOMEBOOKS_PORT=NAS-LAN-IP:3000
BETTER_AUTH_URL=http://NAS-LAN-IP:3000
BETTER_AUTH_SECRET=REPLACE_GENERATED_AUTH_SECRET
HOMEBOOKS_SETUP_TOKEN=REPLACE_GENERATED_SETUP_TOKEN
HOMEBOOKS_REGISTRATION_ENABLED=false
```

Replace both `NAS-LAN-IP` values with the NAS's stable LAN address. The default project creates `homebooks_homebooks-data` and `homebooks_homebooks-backups`; changing the project name starts with different volumes. `HOMEBOOKS_PORT` accepts the host's bind address and port in this example. The repository's default port setting publishes on all host interfaces, so configure the LAN bind address and private-network firewall before starting. Do not forward the app port through the router.

Set `BETTER_AUTH_URL` to the exact origin opened by browsers, including a nondefault port. LAN HTTP is the household's initial choice. If Ethan adds HTTPS, bind the application port to the trusted proxy interface, configure its certificate and private access, and set the HTTPS browser origin. Forwarded-IP headers must come only from that trusted proxy. HTTPS origins use Secure cookies. For later remote access, prefer private HTTPS; [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) is an optional private-network proxy. Its configuration and acceptance checks are outside this initial LAN installation.

Compose fixes the application database at `/data/homebooks.sqlite` and snapshots at `/backups`. Its named volumes survive container replacement and ordinary `docker compose down`. Record their names and Docker storage location. Never use `down --volumes` on the household instance unless the operator explicitly intends to delete its data.

## Start and initialize the instance

Run these commands in the configured project directory:

```sh
docker compose up --build -d --wait --wait-timeout 180
docker compose ps
docker compose logs --tail 100 app
```

Check `/api/health` at the configured browser origin. Open `/setup` and create the first administrator with email, username, display name, a 12-to-128-character password, and the setup token. Sign in normally after setup. First-admin creation is atomic and setup remains unavailable after initialization.

Remove `HOMEBOOKS_SETUP_TOKEN` from the host configuration after setup and recreate the container:

```sh
docker compose up -d --force-recreate --wait
```

The administrator's Backup status link opens `/admin/backups`. Administration grants access to instance status and host operations. It grants no sheet access through normal financial routes. Create sheets under the appropriate user's login and invite other users through Share. Sheet creation adds protected Uncategorized and Unassigned defaults without fixture transactions or household labels.

To register household members, set `HOMEBOOKS_REGISTRATION_ENABLED=true` in `.env`, recreate the container, and use `/register`. After registration, set it back to `false` and recreate again. Confirm that `/register` and direct signup requests reject new accounts. Keep existing passwords and usernames in the household's protected credential store.

## Check storage and daily backups

Allow roughly 2 GB initially for persistent database and backup storage, plus space for Docker images and build cache. This is a planning allowance, not a limit. The tested release image occupied about 728 MiB. A synthetic sample with 10,000 additional imported transactions, each with one split, source row, and review row, used about 24 MB for SQLite and about 366 MB for the live database plus fourteen full snapshots. More splits, import history, manual snapshots, and protected recovery copies increase storage. Monitor the actual NAS volumes and keep room for a new snapshot and an upgrade.

The managed launcher applies migrations before serving requests. It owns the runtime lease, one daily scheduler, and the Next.js process. The scheduler runs at 00:00 UTC, catches up after missed startup, prevents overlap, retries failed checks after five minutes, and retains fourteen validated daily bundles. It preserves manual, pre-upgrade, pre-restore, and invalid bundles for operator decisions.

Open Backup status as the instance administrator and confirm a validated daily success. Check the explicit UTC timestamps after restart. Stale, stopped, unreadable, or mismatched status reports unavailable. Investigate status failures through host logs and writable storage before treating the last known timestamp as current protection.

Create and validate a host snapshot:

```sh
SNAPSHOT_DIRECTORY="$(docker compose exec -T app node operations/backup.mjs create | tr -d '\r')"
docker compose exec -T app node operations/backup.mjs validate "$SNAPSHOT_DIRECTORY"
```

Run each command only after the preceding command succeeds. A bundle contains `database.sqlite` and `manifest.json`. Creation uses SQLite's online backup API and validates the offline copy. Never copy a live database file or omit the manifest.

Follow the [encrypted off-host export and rotation runbook](backup-runbook.md). Separate `/data` and `/backups` volumes on one machine do not protect against host loss. Confirm a download, checksum, decryption, snapshot validation, and fresh-volume restore with the actual destination and recovery operator before household use. Keep the auth secret, release image, origin, Compose settings, volume mappings, and encryption credentials recoverable alongside protected operator records.

## Recover a password without email

Create a temporary operator-readable file containing only the new password. Keep that file outside the repository. Run the recovery command with stdin:

```sh
docker compose exec -T app node operations/recover-password.mjs REPLACE_USERNAME_OR_EMAIL < /secure/path/new-password
```

The command changes only the named user's password and revokes their sessions atomically. It does not print the password. Remove the exact temporary file after success. Sign in with the new password and confirm that the old session requires authentication.

## Upgrade a working instance

Record the current image ID and source commit in protected operator records:

```sh
docker compose images app
git rev-parse HEAD
```

Create and validate a manual snapshot with the commands above. Export and verify it off-host before upgrading. Keep the current release image until the replacement passes its checks.

Check out the reviewed replacement release and build it before stopping the working instance:

```sh
RELEASE_REF=REPLACE_REVIEWED_TAG_OR_COMMIT
git fetch origin
git checkout "$RELEASE_REF"
docker compose build app
docker compose stop app
docker compose up -d --no-build --wait --wait-timeout 180
```

Startup validates the existing schema, creates a protected pre-upgrade snapshot if migrations are pending, and applies migrations before starting the server. Check health, normal sign-in, known money totals, member access, and backup status after the upgrade. If startup rejects the database or migration, inspect the error and preserve the volumes. Use the matching previous image and a validated pre-upgrade snapshot for recovery. Do not start an older image against an unsupported newer schema.

## Restore a trusted snapshot offline

Use an image compatible with the snapshot's migrations and schema. Mount an operator-verified bundle read-only. Stop every process that can open the target database before replacing it:

```sh
VERIFIED_DIRECTORY=/REPLACE_ABSOLUTE_VERIFIED_BUNDLE_DIRECTORY
docker compose stop app
docker compose run --rm --no-deps --volume "$VERIFIED_DIRECTORY:/restore-source:ro" --entrypoint node app operations/backup.mjs validate /restore-source
docker compose run --rm --no-deps --volume "$VERIFIED_DIRECTORY:/restore-source:ro" --entrypoint node app operations/backup.mjs restore /restore-source
docker compose up -d --no-build --wait --wait-timeout 180
```

Do not proceed after a failed validation or restore. Restore rechecks integrity, checksums, supported migrations, and the schema. A rejected candidate leaves the current database intact. Successful replacement preserves the prior offline database and any sidecars under `/backups/preserved-before-restore-*`, with a checksum manifest. It removes stale target WAL and SHM files and invalidates restored sessions. The preservation directory is an offline recovery record, not a validated snapshot bundle for direct import.

Sign in again and verify the known transactions, splits, monthly limits, user identities, membership, pending invitations, and removed-member restrictions. Reimport the same synthetic verification file with the same account and profile and confirm zero additions. Confirm that prior sessions cannot read sheets. Keep the preserved directory until recovery checks and off-host protection succeed.

## Rehearse recovery in fresh volumes

Use a distinct project name and a spare private-network port. Retain the production image and auth secret. Tag the recorded image for this isolated project:

```sh
RELEASE_IMAGE=REPLACE_RECORDED_IMAGE_ID
RECOVERY_PROJECT=REPLACE_UNIQUE_REHEARSAL_PROJECT
RECOVERY_BIND=REPLACE_PRIVATE_HOST_IP:REPLACE_SPARE_PORT
RECOVERY_ORIGIN=http://REPLACE_PRIVATE_HOST_IP:REPLACE_SPARE_PORT
VERIFIED_DIRECTORY=/REPLACE_ABSOLUTE_VERIFIED_BUNDLE_DIRECTORY
docker tag "$RELEASE_IMAGE" "$RECOVERY_PROJECT-app"
docker compose -p "$RECOVERY_PROJECT" run --rm --no-deps --volume "$VERIFIED_DIRECTORY:/restore-source:ro" --entrypoint node app operations/backup.mjs restore /restore-source
HOMEBOOKS_PORT="$RECOVERY_BIND" BETTER_AUTH_URL="$RECOVERY_ORIGIN" docker compose -p "$RECOVERY_PROJECT" up -d --no-build --wait --wait-timeout 180
```

Verify that the rehearsal project name has never held household data before the restore. Confirm the preceding recovery checks through the rehearsal origin. After recording the results, stop the rehearsal and remove only its generated volumes:

```sh
docker compose -p "$RECOVERY_PROJECT" down --volumes --remove-orphans
```

For code-release verification with entirely synthetic data, run the published drills from the source checkout:

```sh
pnpm docker:drill
pnpm docker:restore-drill
```

Each drill generates its own project names, ephemeral ports, secrets, and volumes. The recovery drill builds the candidate image by default and prints its immutable ID. It creates data through the real APIs, verifies restart persistence and populated daily catch-up, and restores into fresh volumes. It checks exact fixture money, every stored field in domain and credential tables, fresh sign-in, permissions, reimport with zero additions, corrupt and incompatible candidate rejection, and byte-for-byte prior preservation with stale sidecar removal.

To independently repeat either drill against that exact already-built image, set `HOMEBOOKS_DRILL_IMAGE` to its printed image ID. Do not use an unrelated older image to validate current source changes. The recovery drill checks that its exact generated projects and volume names do not already exist. Cleanup tears down those projects and explicitly removes their remaining offline-created volumes by exact name. It does not prune other Docker resources. Generated image tags remain available for inspection and reuse.

## Diagnose failed startup or recovery

- Unhealthy container: inspect `docker compose logs app`, the exact configured origin, valid secrets, and volume permissions. The image runs as UID 1001 and GID 1001.
- Wrong origin or failed sign-in: compare the browser origin with `BETTER_AUTH_URL` and the proxy's HTTPS configuration. Preserve the original auth secret during recovery.
- Backup failure: check writable `/backups`, free space, `daily-backup-failed` logs, and operations leases. Status unavailable also requires checking `/data` and `backup-status-write-failed` logs.
- Stale lease after forced termination: verify all app and database-operation processes are stopped before removing only the intended database's runtime and operations lock directories. A PID missing from another container does not prove the lease is abandoned.
- Incompatible candidate: retain the current database and use the release that supports the trusted snapshot. Do not edit the snapshot manifest to bypass checks.

Complete the [release acceptance procedure](release-checklist.md) and record the tested image, source commit, commands, and limitations. Isolated passing drills do not confirm the household host, off-host transfer, proxy, operator access, or unresolved MVP tracker items.
