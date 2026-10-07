# Homebooks MVP implementation plan

Homebooks is a self-hosted household app for tracking spending against monthly category limits, with family expense attribution. Users enter transactions manually or import CSV files. The app stores no bank credentials.

Revised October 2, 2026, after reviewing the initial plan. This describes the proposed implementation; the repository has no app code yet.

Review the editable [system design diagram](system-design.excalidraw) alongside this plan. Its three panels cover runtime and operations, sheet data and calculations, and import and sharing workflows. Open the file in Excalidraw to pan between panels and edit it. The [image preview](system-design-preview.png) stacks the same panels vertically for reading without an editor.

The [website specification](website-spec.md) defines layouts, visual tokens, responsive behavior, and interaction states. The [visual reference](website-reference.html) illustrates representative screens. UI implementation and agent handoffs follow those references alongside this plan.

## MVP decisions

- Each person has one login. Every user can create sheets and becomes the owner of each sheet they create.
- A sheet contains financial accounts, transactions, categories, attribution buckets, and monthly budgets. Personal and Family are separate sheets.
- Sharing grants access to the whole sheet. Only the owner can invite people or revoke access.
- Owners search existing users by display name. Results also show a unique username to distinguish people with the same name. Invitations target stable user IDs.
- Invitees can see invitations but cannot open a sheet until acceptance.
- Buckets identify whose expense a split represents. Use stable names such as Ethan and Parents, rather than viewer-relative names such as Mine. Attribution does not require that person to have a login.
- Buckets do not represent cash balances, savings envelopes, or amounts owed.
- Budgets are monthly category spending limits. They include all buckets on the sheet and do not roll over.
- Each sheet uses one currency, selected at creation. Currency conversion and changing currency after transactions exist are outside the MVP.
- Financial accounts group transactions by source, such as checking, cash, or a credit card. Account balances and statement reconciliation are deferred.
- CSV and manual entry are the initial sources. Support the CSV exports actually used by the household before adding formats.
- Instance administration is separate from sheet ownership. Administration does not grant access through normal sheet routes, but the server operator and full-instance backups can access all stored data.

## Stack and runtime

| Layer | Choice | Responsibility |
| --- | --- | --- |
| App | Next.js App Router, TypeScript, standalone Docker image | Pages and server operations in one codebase |
| UI | React | Overview, ledger, budgets, import, sharing, and settings |
| Auth | Better Auth, Drizzle adapter, username plugin | Email/password credentials, username sign-in, and server sessions |
| Database | SQLite with Drizzle | Durable records, migrations, and atomic writes |
| Scheduling | One in-process daily backup scheduler | Invoke the same snapshot operation as the admin command |
| Deployment | Docker Compose, one app instance, local named volumes | Database at `/data`; snapshots at `/backups` |

Registration requires email, unique username, display name, and password. Sign-in accepts email or username. Generate Better Auth's required schema and keep credential handling inside Better Auth. Its auth account table is distinct from `financial_accounts`.

Bootstrap the first admin with a one-time setup token and an atomic initialization operation. Enable household registration explicitly through instance configuration, then disable it after users register. Provide an admin password-recovery command without requiring an email service. Document the origin, auth secret, HTTPS setup, volume paths, and registration configuration.

Run migrations before starting the web server and scheduler. Snapshot an existing database before upgrading it. Enable SQLite foreign keys and keep the database on local storage. A single app instance owns the scheduler; multiple replicas are deferred.

## Server responsibilities

These are responsibilities within the app, not separate services:

1. Better Auth establishes the current user from the session.
2. The sheet access check identifies its owner or an accepted member. Owner-only operations check ownership separately.
3. Ledger operations validate types, signed amounts, splits, and same-sheet references, then write atomically.
4. CSV import normalizes rows, preserves source identity, presents duplicate decisions, and commits reviewed batches atomically.
5. One spending calculation supplies Overview and Budgets. Attribution groups the same expense and refund splits by bucket.
6. Sharing checks the actor, invitation state, and current ownership before changing access.

Authorize every server read and mutation. Hidden buttons and the sheet switcher are not access controls. Reject references to another sheet's account, category, bucket, transaction, or import batch. Recheck authorization when committing an import or accepting an invitation.

## Money and calculation rules

Store amounts as signed integers in the sheet currency's minor units. Parse decimal input without floating-point arithmetic and reject values outside the supported integer range. Outflows are negative and inflows are positive. For USD, a $100 purchase is `-10000`.

Use date-only `YYYY-MM-DD` transaction dates and `YYYY-MM` budget months. Spending belongs to the transaction's effective month, independent of the server timezone. A refund reduces spending in the refund's month, even if the purchase occurred earlier.

| Kind | Amount | Effect on category spending |
| --- | --- | --- |
| Expense | Negative | Adds spending through its category splits |
| Refund | Positive | Reduces spending through its category splits |
| Income | Positive | Excluded |
| Transfer | Positive or negative | Excluded, including credit-card payments |

Every transaction has at least one split. Ordinary transactions have one split for the entire amount. Every split has a category and bucket from the same sheet and uses the parent's sign. Split amounts sum exactly to the parent. Reject zero amounts and mixed-sign splits in this MVP. Validate the entire transaction on create, edit, and import confirmation.

Create a protected Uncategorized category and Unassigned bucket on each sheet. Imported expenses use those defaults until edited. Income and transfers also have a split, but their splits do not contribute to spending. Uncategorized expenses remain visible in Overview.

Category spending is the negated sum of expense and refund splits for that category and month. Remaining budget equals its monthly limit minus category spending. A $100 expense and $20 refund yield $80 spending. Negative remaining values show overspending; do not clamp them to zero.

Overview shows net spending, spending against budgeted categories, uncategorized spending, attribution totals, and recent transactions. Label any combined remaining value as remaining for budgeted categories. Categories without limits still contribute to total spending. There is no safe-to-spend balance or amount-owed widget.

Card purchases are expenses; card payments are transfers. Importing both checking and card files must not count the payment as another expense. Preview requires users to identify transfers that cannot be inferred reliably. Pairing transfer rows and double-entry accounting are deferred.

## Permissions and sharing

| Action | Sheet owner | Accepted member | Other user |
| --- | --- | --- | --- |
| View/edit transactions, accounts, categories, buckets, budgets | Yes | Yes | No |
| Preview and commit imports | Yes | Yes | No |
| Search users for invitations to this sheet | Yes | No | No |
| Invite, revoke membership, rename, delete sheet | Yes | No | No |
| Leave sheet | Delete instead | Yes | No |
| Accept or decline invitation addressed to them | As invitee | As invitee | As invitee |

Administration is a separate permission. Backup and restore commands require host access, rather than sheet membership. Browser backup download and restore are deferred.

`sheets.owner_id` is the single ownership authority. `sheet_members` stores accepted non-owner members only. Ownership transfer is deferred. Owners cannot remove themselves while retaining the sheet.

Invites have pending, accepted, declined, or revoked states. Permit one pending invite per sheet and invitee. Acceptance atomically checks the recipient and pending state, inserts membership once, and marks the invite accepted. Repeated acceptance must not duplicate membership. Revoking a pending invitation blocks acceptance. Removing an accepted member blocks their next operation. A former member needs a new invitation to return.

Incoming invitations are globally available, including for users without sheets. Show the inviter and sheet name, but no financial records before acceptance. Search returns limited identity fields, excludes existing members and pending invitees, and requires a sheet-owner operation. Rate-limit search and invitations.

## Data model

Use Better Auth's generated user, session, auth account, and verification tables. Add display name, username through its plugin, and a server-controlled instance-admin flag. Do not store passwords in a custom user table.

| App table | Purpose and constraints |
| --- | --- |
| `sheets` | Name, currency, `owner_id` referencing an auth user |
| `sheet_members` | Accepted non-owner members; unique `(sheet_id, user_id)` |
| `sheet_invites` | Sheet, inviter, invitee, state, timestamps; one pending invite per sheet and recipient |
| `financial_accounts` | Sheet, name, source type, archive state; no calculated balance |
| `categories` | Sheet, name, archive state; protected Uncategorized default |
| `buckets` | Sheet, attribution label, archive state; protected Unassigned default |
| `transactions` | Sheet, account, date, payee, kind, signed amount, creator, timestamps, version, deletion state |
| `splits` | Sheet, transaction, signed amount, category, bucket; at least one per transaction |
| `budgets` | Sheet, category, month, nonnegative limit, version; unique `(sheet_id, category_id, month)`. Removed limits retain a null limit and increasing version to reject stale create/edit/delete attempts; null is unbudgeted, zero is a real limit |
| `import_batches` | Sheet, account, source profile, normalized file hash, mapping, state, creator, timestamps |
| `import_rows` | Batch, source row position, immutable normalized source fields, optional source ID, fingerprint, decision, linked transaction |

Carry `sheet_id` through sheet-owned records and enforce same-sheet references with composite foreign keys where practical. Keep split-sum validation and atomic writes in one ledger operation. Archive used accounts, categories, and buckets to preserve historical references.

Deleted transactions remain as tombstones, are excluded from totals, and retain import identity. Reinstating a deleted imported transaction is explicit. Fingerprints aid lookup; they are not unique transaction constraints. Editing transaction fields never rewrites imported source identity.

## CSV import contract

1. Select the sheet and financial account, upload a CSV, and choose or save that account's source mapping.
2. Map date, payee, amount or debit/credit columns, and optional source ID. Specify date format and sign conventions. Do not guess ambiguous dates or decimal separators.
3. Normalize into the manual-entry transaction shape. Enforce file-size and row-count limits. Show row errors, default attribution/category, and proposed kinds.
4. Preview new rows, definite duplicates, possible duplicates, invalid rows, and excluded rows. Possible duplicates require an explicit keep-or-skip decision.
5. Confirm reviewed rows. Recheck membership and duplicate identity against current records, then write transactions, splits, source links, and batch status in one database transaction. A stale preview returns for review rather than silently changing the approved result.

Scope matching to the financial account and source profile. A matching stable source ID with unchanged source fields is a definite duplicate. Conflicting fields require review. An already committed file hash with the same mapping is a definite repeat and adds nothing.

Without stable IDs, compare immutable normalized source fields and occurrence counts. Preserve multiple identical rows in a new file as distinct purchases. Across overlapping files, matching date/payee/amount tuples and matches to manual entries are possible duplicates, not automatic exclusions. Explain the ambiguity and let the user decide.

Correct or explicitly exclude invalid rows before confirmation. Repeated confirmation must not create transactions again, including after timeouts or concurrent confirmation. Edits and tombstones preserve duplicate detection. Persist matching and review fields without retaining the original uploaded file by default. Cleaning up abandoned previews must not remove committed identity records.

## Backup and restore

Foundation includes backup and restore before real data is used. Snapshot through SQLite's online backup API or `VACUUM INTO`, rather than copying a live database file. Validate snapshot integrity before marking success. See [SQLite backup documentation](https://sqlite.org/backup.html) and [WAL documentation](https://sqlite.org/wal.html).

- Store daily timestamped snapshots in a separate `/backups` volume. Retain 14 daily snapshots. Preserve explicit pre-upgrade and pre-restore snapshots until the admin removes them.
- Initialize scheduling once after startup. Run a missed daily backup on startup, prevent overlapping runs, and expose the last success or failure in admin status.
- Provide a host command to create and export a snapshot. Document off-host copying; separate volumes on the same host do not protect against host loss.
- Restore by stopping the app, validating integrity and supported schema version, preserving the current database, replacing it without stale WAL files, and restarting. Failed validation leaves the current database intact.
- Document deployment secrets needed alongside a snapshot. Recover auth and app data but invalidate restored sessions so users sign in again.
- Before release, restore into a fresh volume and verify known transactions, splits, budgets, users, memberships, and import identities. Include this procedure in deployment instructions.

## MVP screens

Navigation contains a sheet switcher, Overview, Transactions, Budgets, Import, and Settings. Owners can open Share. Incoming invitations are available independently of the selected sheet. Keep Add transaction accessible on a phone.

| Screen | Behavior |
| --- | --- |
| Registration/sign-in | Controlled registration; email or username sign-in |
| Overview | Month selection, net spending, budgets, uncategorized spending, attribution, recent transactions |
| Transactions | Add/edit/delete, filters, splits, expense/refund/income/transfer kinds |
| Budgets | Monthly category limits, actuals, remaining values, overspending |
| Import | Account, mapping, validation, duplicate decisions, preview, confirmation |
| Settings | Sheet name, accounts, categories, buckets, members/invites, profile display name |
| Share/incoming invites | Display-name search with username disambiguation; send/accept/decline/revoke |

Keep the paper-like visual direction with a dark green accent. Build responsive forms and empty, loading, and error states with each screen. Record creator and update timestamps. Reject stale transaction and budget edits using record versions and a reload prompt instead of silently overwriting another member's changes. A full audit history is deferred.

## Build order and exit checks

Use sample data until Foundation's backup and restore checks pass. Each stage ends in observable behavior.

| Stage | Build | Exit check |
| --- | --- | --- |
| 0. Foundation | Docker, migrations, auth, controlled registration, sheets, isolation, snapshot/restore commands | Two users have isolated sheets; cross-sheet reads/writes fail; restart preserves data; fresh-volume restore recovers samples |
| 1. Spending | Accounts, categories, buckets, manual transactions, splits, refunds, income, transfers, filters | Split purchase/refund/payment produce exact totals; bad sums and cross-sheet references fail |
| 2. Import | Household CSV profile, mapping, validation, identity, preview, atomic confirmation | Repeat adds nothing; identical purchases survive; ambiguous matches require review; retries are safe |
| 3. Budgets | Monthly limits and Overview sharing one calculation | Month boundaries, refunds, unbudgeted/uncategorized spending, and overspending have expected values |
| 4. Sharing | Search, invitations, accept/decline/revoke/leave, stale-edit checks | Pending users cannot read data; members can edit; repeated acceptance is harmless; removal blocks next operation |
| 5. Family release | Scheduling/status, deployment/recovery instructions, complete states, phone checks | Restore last night's snapshot into a fresh volume; verify data/permissions; use entry and import review on a phone |

Write focused automated tests for calculations, authorization, invitation transitions, import identity/retries, stale edits, and atomic writes. Check manual entry, splits, imports, budgets, and sharing in a browser. Run a real Docker persistence and restore drill. Type-checking alone does not prove money or access rules.

## Release acceptance examples

- A $100 Groceries expense split $60 to Ethan and $40 to Parents contributes $100 to Groceries, $60 to Ethan attribution, and $40 to Parents attribution.
- A subsequent $100 card payment adds $0 spending, even when both sides appear in imported files.
- A $20 Groceries refund attributed to Ethan that month reduces Groceries spending to $80 and Ethan attribution to $40.
- A $150 Groceries limit then shows $70 remaining. A $50 limit shows $30 overspent. Income changes neither value.
- A refund the following month reduces that month's spending without changing the earlier report.
- Reimporting the same file adds nothing, even after editing or deleting imported transactions.
- Two $10 purchases with the same date and payee in a new file remain two purchases. An ambiguous match in a later file requires review.
- Failed confirmation leaves no partial transactions. Retrying successful confirmation adds nothing.
- An unrelated user cannot access a sheet by supplying its ID or attach another sheet's category or bucket to a split.
- Before acceptance, an invitee cannot see financial records. Repeated acceptance creates one membership. A revoked pending invite cannot be accepted. Removed members lose access on their next operation.
- Concurrent edits produce a visible conflict rather than silently losing changes.
- Fresh-volume restore recovers users, memberships, transactions, splits, budgets, and import identities, and requires sign-in again.

## Follow-up work

- Goals and savings progress
- Automatic payee categorization rules
- OFX/QFX and additional CSV profiles
- Amounts owed, reimbursements, and settlement tracking
- Account balances, opening balances, reconciliation, linked transfers
- Funded envelopes, rollover, per-bucket budgets
- Ownership transfer, read-only members, full edit history
- Browser backup download/restore
- Bank connections, automatic imports, file watchers
- Multiple currencies, investments, subscription analysis, native mobile apps
- Private rows within shared sheets and member invitations

## Household inputs for implementation

These choices refine the release without expanding scope:

Confirmed decisions, delegated label choices, remaining questions, and the explicitly unconfirmed synthetic CSV candidate are recorded in [Household implementation inputs](household-inputs.md). The household-inputs issue remains open until the actual export conventions and production deployment/backup targets are known.

- Which CSV exports must work first, including date, amount, and source-ID fields?
- Which currency and attribution labels should the initial sheets use?
- Will access use a private network or an HTTPS endpoint? Deployment instructions must match that choice.

## Reference notes

Better Auth's [database schema](https://better-auth.com/docs/concepts/database) owns credentials and sessions. Its [username plugin](https://better-auth.com/docs/plugins/username) adds username sign-in to email/password authentication; registration still requires email.
