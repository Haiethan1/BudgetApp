# Backup export and off-host rotation

Use one managed Homebooks instance. The host operator owns these steps; sheet membership does not authorize them. Daily snapshots at 00:00 UTC retain fourteen successful daily bundles. Local `/data` and `/backups` volumes do not protect against loss of the host.

The administrator's `/admin/backups` page shows validated daily success, failed-check history, next check, and freshness. It reads the supervisor's atomic status beside the database, separately from backup storage. A stopped, mismatched, unreadable, or more-than-two-minute-old status is unavailable. It never exposes file paths, raw errors, or sheet records. Status is informational: exporting and restoring require host access.

## Export a trusted copy

These commands target Docker Compose on a Linux operator host. Configure the actual Compose project and secure local staging location first. The example assumes GnuPG, tar, and SSH tools are installed. `BACKUP_HOST`, `BACKUP_USER`, and `REMOTE_DIRECTORY` below must be replaced with the chosen destination; they are not configured household defaults. Restrict the staging directory and destination to the operator. Store the encryption passphrase in protected operator storage, separately from the archive. Never put it in a command argument, repository, or shell script.

```sh
umask 077
STAGING_DIRECTORY=/secure/homebooks-staging
mkdir -p "$STAGING_DIRECTORY"
COPY_ID="$(date -u +%Y%m%dT%H%M%SZ)"
SOURCE_DIRECTORY="$(docker compose exec -T app node operations/backup.mjs create | tr -d '\r')"
EXPORT_DIRECTORY="/backups/offhost-export-$COPY_ID"
docker compose exec -T app node operations/backup.mjs validate "$SOURCE_DIRECTORY"
docker compose exec -T app node operations/backup.mjs export "$SOURCE_DIRECTORY" "$EXPORT_DIRECTORY"
mkdir "$STAGING_DIRECTORY/$COPY_ID"
docker compose cp "app:$EXPORT_DIRECTORY/." "$STAGING_DIRECTORY/$COPY_ID/"
tar -C "$STAGING_DIRECTORY/$COPY_ID" -cf "$STAGING_DIRECTORY/$COPY_ID.tar" database.sqlite manifest.json
gpg --symmetric --cipher-algo AES256 --output "$STAGING_DIRECTORY/homebooks-$COPY_ID.tar.gpg" "$STAGING_DIRECTORY/$COPY_ID.tar"
scp "$STAGING_DIRECTORY/homebooks-$COPY_ID.tar.gpg" BACKUP_USER@BACKUP_HOST:REMOTE_DIRECTORY/
```

Run each command only after the preceding command succeeds. Creation/export refuses conflicting paths; if an earlier attempt used this second's name, choose a new `COPY_ID`. Export validates the source and copied bundle before publishing. Do not copy the live `/data` database, omit the manifest, or export an unfinished staging bundle.

For a host installation, use `pnpm backup create`, then `pnpm backup export SOURCE_DIRECTORY NEW_EXPORT_DIRECTORY`, and archive that export instead of using Compose copy. Keep both bundle files together. The archive includes credential hashes and all financial records; encryption is required for transfer and remote storage even on a private network.

## Verify the remote copy before cleanup

Download the exact uploaded encrypted file into a new verification directory. Compare its SHA-256 checksum to the local encrypted archive with `sha256sum`. Decrypt it to a new restricted directory with `gpg --output VERIFIED.tar --decrypt DOWNLOADED.tar.gpg`, then inspect `tar -tf VERIFIED.tar` before extracting: it must list only `database.sqlite` and `manifest.json`. Extract those two files into an empty directory. Mount that directory read-only at `/restore-source` in a one-off app container and run `node operations/backup.mjs validate /restore-source`, using the same release image as the source app.

For example, from the Compose project directory, after setting `VERIFIED_DIRECTORY` to the absolute directory containing only the two verified files:

```sh
docker compose run --rm --no-deps --volume "$VERIFIED_DIRECTORY:/restore-source:ro" --entrypoint node app operations/backup.mjs validate /restore-source
```

Record archive name, UTC creation time, checksum, destination, and verification result in protected operator records. A checksum detects corruption; trust comes from the controlled source and storage. Complete a fresh-volume restore drill periodically and after deployment changes. Confirm that users, permissions, financial data, and import identity recover, and restored sessions require sign-in. Validation alone does not prove a deployable recovery.

After remote verification succeeds, remove only this run's plaintext tar, staging bundle, and local encrypted transfer copy from secure staging. The container's `offhost-export-*` and manual source snapshot are not managed daily snapshots; remove those exact named bundles when no longer needed, preserving their files until transfer verification completes. Do not use a broad recursive cleanup against `/backups` or operator-selected paths. Snapshot retention intentionally does not delete manual or protected recovery copies.

## Rotation and secrets

Perform one off-host copy per UTC day. Keep at least fourteen verified daily archives on the separate host. At the weekly review, list only `homebooks-YYYYMMDDTHHMMSSZ.tar.gpg` archives in the chosen dedicated directory, order by UTC name, verify the newest fourteen have recorded successful verification, and remove older copies individually by exact filename. A failed or missing daily export does not count toward the fourteen. Keep pre-upgrade/pre-restore copies separately with their reason and release; remove them only by explicit operator decision. Never rotate the last known working recovery copy because a newer upload exists.

Keep `BETTER_AUTH_SECRET`, exact release/image version, origin/HTTPS configuration, Compose configuration, volume mappings, and encryption recovery credentials in protected operator storage. The setup token is not required after initialization. Store secrets separately from the public repository and archive transfer directory. Test access to both archive and encryption credentials from the recovery operator's environment.

The actual production host, origin, private-network/HTTPS mode, and off-host destination must be confirmed in [household inputs](household-inputs.md). A documented workflow does not mean those production locations have been provisioned.

## Failure and recovery checks

- No validated daily success: inspect `daily-backup-failed` host logs, writable `/backups`, free space, and the operations lease. The scheduler retries after five minutes without overlapping other operations.
- Status unavailable: check the managed supervisor, `/data` write access, and `backup-status-write-failed` logs; refresh the page after recovery. The status file is beside the database so a failed `/backups` mount can still report a failed check. If `/data` also fails, the page reports unavailable instead of treating old status as active.
- Historical failure after a successful check: the failure timestamp remains for investigation; the latest-check notice identifies recovery. Retention failures count as failed checks even when that attempt published a valid snapshot.
- Stale runtime or operations lease: verify every app and database-operation process/container is stopped before removing only the intended database's lock directories. Do not delete a lease because a PID is absent in a different container. Forced termination may require this verified offline recovery.
- Restore: follow [offline restore](../README.md#snapshots-and-offline-restore). Stop the app, validate the trusted bundle, preserve the current database, restore without stale WAL files, and restart. Validate a replacement in fresh volumes before replacing a working instance.
