# Homebooks MVP implementation plan

For the approved user-feedback follow-up covering issues #29–40, see the [user-feedback implementation plan](user-feedback-implementation-plan.md) for implementation order, dependencies, shared components, and validation gates. It describes planned extensions, not shipped behavior.

Homebooks is a self-hosted household app for tracking spending against monthly spending category limits, with expense allocation by spending group. Users enter transactions manually or import CSV files. The app stores no bank credentials.

This document defines implemented behavior and release gates, including the improvements merged in PR #28. Planned changes from issues #29–40 remain separate until implemented. The repository now implements the app; see the [README](../README.md), [release acceptance procedure](release-checklist.md), and [deployment guide](deployment-guide.md) for current usage and verification. Unconfirmed production inputs remain in [household inputs](household-inputs.md).

Review the editable [system design diagram](system-design.excalidraw) alongside this plan. Its three panels cover runtime and operations, sheet data and calculations, and import and sharing workflows. Open the file in Excalidraw to pan between panels and edit it. The [image preview](system-design-preview.png) stacks the same panels vertically for reading without an editor.

The [website specification](website-spec.md) defines layouts, visual tokens, responsive behavior, and interaction states. The [visual reference](website-reference.html) illustrates representative screens. UI implementation and agent handoffs follow those references alongside this plan.

## MVP decisions

- Each person has one login. Every user can create sheets and becomes the owner of each sheet they create.
- A sheet contains transaction accounts, transactions, spending categories, spending groups, and monthly budgets. Personal and Family are separate sheets.
- Sharing grants access to the whole sheet. Only the owner can invite people or revoke access.
- Owners search existing users by display name. Results also show a unique username to distinguish people with the same name. Invitations target stable user IDs.
- Invitees can see invitations but cannot open a sheet until acceptance.
- Spending groups identify whose expense a split represents. Use stable names such as Ethan and Parents, rather than viewer-relative names such as Mine. Spending group does not require that person to have a login.
- Spending groups describe whose spending each expense belongs to. They do not require a login and are distinct from People, which controls sheet access. Amount owed uses only spending groups explicitly selected for repayment tracking; no spending group is tracked by default. Spending groups are not cash balances or savings envelopes.
- Budgets are monthly limits for spending categories. They include all spending groups on the sheet and do not roll over.
- Each sheet uses one currency, selected at creation. Currency conversion and changing currency after transactions exist are outside the MVP.
- Transaction accounts group transactions by source, such as checking, cash, or a credit card. Transaction account balances and statement reconciliation are deferred.
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

Coordinate startup, runtime, and host operations with SQLite OS locks in separate files beside the database. Runtime locks remain held by the launcher and web processes; startup and offline restore require exclusive access. Serialize database operations separately. Process death and machine restarts release locks automatically, and retained coordination files must be reusable without manual cleanup. Legacy directory leases require one verified offline migration. Test forced termination, restart persistence, live-instance exclusion, and a surviving web process after launcher failure.

## Server responsibilities

These are responsibilities within the app, not separate services:

1. Better Auth establishes the current user from the session.
2. The sheet access check identifies its owner or an accepted member. Owner-only operations check ownership separately.
3. Ledger operations validate types, signed amounts, splits, and same-sheet references, then write atomically.
4. CSV import normalizes rows, preserves source identity, presents duplicate decisions, and commits reviewed batches atomically.
5. One spending calculation supplies Overview and Budgets. Reports group the same expense and refund splits by spending group.
6. Sharing checks the actor, invitation state, and current ownership before changing access.

Authorize every server read and mutation. Hidden buttons and the sheet switcher are not access controls. Reject references to another sheet's transaction account, spending category, spending group, transaction, or import batch. Recheck authorization when committing an import or accepting an invitation.

## Money and calculation rules

Store amounts as signed integers in the sheet currency's minor units. Parse decimal input without floating-point arithmetic and reject values outside the supported integer range. Outflows are negative and inflows are positive. For USD, a $100 purchase is `-10000`.

Use date-only `YYYY-MM-DD` transaction dates and exact `YYYY-MM-DD` period-start budget keys. Spending belongs to the sheet's recurring monthly cycle containing the transaction's effective date, independent of the server timezone. A refund reduces spending in the refund's cycle, even if the purchase occurred earlier.

| Kind | Amount | Effect on spending category spending |
| --- | --- | --- |
| Expense | Negative | Adds spending through its spending category splits |
| Refund | Positive | Reduces spending through its spending category splits |
| Income | Positive | Excluded |
| Transfer | Positive or negative | Excluded, including credit-card payments |

Every transaction has at least one split. Ordinary transactions have one split for the entire amount. Every split has a spending category and spending group from the same sheet and uses the parent's sign. Split amounts sum exactly to the parent. Reject zero amounts and mixed-sign splits in this MVP. Validate the entire transaction on create, edit, and import confirmation.

Create a protected Uncategorized spending category and Unassigned spending group on each sheet. Imported expenses use those defaults until edited. Income and transfers also have a split, but their splits do not contribute to spending. Uncategorized expenses remain visible in Overview.

Spending category spending is the negated sum of expense and refund splits for that spending category and month. Remaining budget equals its monthly limit minus spending category spending. A $100 expense and $20 refund yield $80 spending. Negative remaining values show overspending; do not clamp them to zero.

Each spending category can have a recurring default limit. Changes apply from the current UTC budget period onward to periods without an explicit override. Earlier periods retain their effective defaults and spending comparisons. Existing monthly limits remain overrides. A month can override the amount, explicitly remove the limit, or return to the default. Default changes preserve current and future explicit overrides unless the user explicitly chooses to replace the current override. Migration 0013 baselines all existing defaults, including null removal revisions, so upgrading changes no report. Append-only effective-period revisions retain history; repeated current changes take effect at that same exact period start. Both defaults and overrides use optimistic revisions; setting a default from the monthly dialog is atomic.

Overview shows net spending, spending against budgeted spending categories, uncategorized spending, spending group totals, and recent transactions. Label any combined remaining value as remaining for budgeted spending categories. Spending categories without limits still contribute to total spending. There is no safe-to-spend balance. Amount owed is a separate all-time expense repayment view.

Card purchases are expenses; card payments are transfers. Importing both checking and card files must not count the payment as another expense. Preview proposes kinds and highlights card payments as Transfers. Users can change kinds that cannot be inferred reliably. Valid rows import with their proposed values and protected spending category/spending group defaults without individual review or saving. A valid source correction is also importable immediately unless its duplicate matching requires an explicit decision. Pairing transfer rows and double-entry accounting are deferred.

## Historical sheet-wide budget cycles

Each sheet has one monthly schedule across every transaction account. New sheets start on day 1. Migration 0012 preserves each existing sheet's configured day and cycle revision as its baseline. Starts clamp independently to the month's last day, including Gregorian leap-year rules. Inclusive ends are the day before the next start. The shared date-only resolver supplies spending, Overview, Budgets, navigation and initial ledger filtering. Stored transaction dates never change. Current period and effective-date eligibility use the UTC calendar date consistently on browser and server; date-only boundaries never depend on host timezone. Supported dates are 0001-01-01 through 9999-12-31; the earliest partial period and final period clip to those limits.

Only owners can change a cycle. Choose a monthly day, an explicit first new recurring start, and a shorter or longer one-time transition. The effective date must be today or later and match the chosen day after clamping. For a short transition, retain the original period containing the date immediately before that first new start. For a long transition, retain the preceding original period and extend it until the day before the first new start. Reject a plan if its transition would begin before the currently active period, replace an already scheduled transition, or exceed supported dates. Schedule revisions append in order; completed period boundaries never change. A current period may shorten or lengthen, with its before/after reporting dates shown in preview. Choose a later date to leave the current period unchanged.

Period identity is its exact start date. Migration converts each old YYYY-MM override key to its original independently clamped start date, retaining limit amounts, inheritance flags, explicit zero, explicit no limit and versions. Existing defaults remain unchanged by this migration. Legacy YYYY-MM read URLs select the first period starting in that month, or the containing transition when no period starts in that month; canonical navigation uses exact starts so two starts in the same month remain distinct. Exact keys that cease to be starts are rejected for budget writes. Legacy month writes reject months with zero or multiple starts. After a revision, cycleVersion is mandatory for period writes. Cycle revision checks prevent stale clients from saving against moved boundaries.

The transition retains its full existing limit or recurring default. Homebooks never automatically prorates limits. Every future override moves one-to-one by successor position from the transition into the new schedule, including far-future overrides. This is an intentional mapping policy: after a short transition, an old next-month override may move to a new period starting later in the transition's month. Before saving, the server preview lists each affected category, old and new dates, amount or explicit no-limit or inheritance choice, and effective inherited amount. Amounts, inheritance and override revisions remain unchanged. Reject date-range overflow rather than dropping an override. The owner can edit individual limits in Budgets after saving.

Preview also shows original affected, transition, new recurring, and current before/after periods. Saving rechecks owner access, cycle revision and a digest of the previewed configuration and affected limits in one immediate transaction. Changed data requires another preview or explicit conflict reload. Dialog inputs remain until the owner discards them. Cycle history is retained in cycle_changes; the baseline day stays on sheets. This exact-start representation supports future effective-period defaults in issue #31; this change does not introduce that separate feature or rollover.

## Amount owed and repayment tracking

History is all-time, independent of the selected budget month. Owners and accepted members explicitly choose tracked spending groups in Amount owed; new and existing spending groups start untracked. Archived spending groups retain their history and can remain tracked. Only expense splits in tracked spending groups contribute to tracked outstanding and paid totals. Refunds, income, transfers, and deleted expenses never contribute, and refunds never infer a repayment.

Settlement applies to the whole expense, including all of its split allocations. A nullable date-only repayment date on the existing transaction ID is the status authority: null means outstanding; a real date means paid back. No partial payments, per-split settlement, payer/payee transaction account balances, or repayment ledger entries are added. A repayment date must be on or after the expense date. Dates are explicit historical records; future dates are permitted, as with transaction dates. Reopening clears the date. Each expense also has one editable comment, up to 2,000 characters, available whether paid or unpaid, including untracked expenses through All expenses. A full comment history is deferred.

Store `repayment_date` and `repayment_comment` directly on `transactions`, so existing stable IDs own the metadata without a second foreign-key record. Every repayment/comment write checks and increments the transaction version atomically. Ledger edits share that version and preserve metadata. Changing the amount or allocations of a paid expense keeps it paid for the revised full expense; the editor explicitly explains this before saving. Changing an expense into another kind clears repayment status and retains its comment; changing it back starts outstanding. Editing a paid expense date after its repayment date is rejected until its repayment date is corrected or it is reopened. Spending group tracking uses its own optimistic version. Concurrent edits preserve local values and require explicit reload. Removing a spending group from tracking hides its contributions without deleting transaction metadata.

## Sheet setup guidance

Settings shows six setup tasks derived on each authorized sheet read, never stored completion flags. One active transaction account is required to save transactions. All other choices are optional, so manual entry is ready with the protected Uncategorized and Unassigned fallbacks, no recurring limits, the existing monthly cycle, and no CSV formats. Protected entries never make required setup incomplete. Custom category/group opportunities count active non-protected entries. Default-budget progress counts active categories with a non-null current effective recurring limit, including zero; explicit no limit remains valid. CSV progress counts only reusable formats on active accounts, excluding internal import identities. A cycle is configured from creation, including day 1; custom scheduling is optional and owner-only.

Required readiness is separate from optional progress. Settings always exposes the checklist with explanations and direct links to the real organization, defaults, cycle and Import CSV controls. Import CSV and Add transaction remain available throughout. Other sheet pages show a dismissible reminder while required or optional opportunities remain; ready sheets promote the first-transaction actions. Optional opportunities are suggestions, not invalid configuration or a gate.

Dismissal uses browser session storage keyed by sheet and a server-hashed user/authenticated-login-session identity, never an auth token. It survives ordinary navigation and reload within that tab and login. A later login, or a new browser tab/session, can show the reminder again while opportunities remain. If browser storage is unavailable, memory preserves dismissal during client navigation. The Settings checklist remains accessible after dismissal. New members see the actual shared configuration without repeating setup. Fresh navigation, returning focus and a 60-second authorized configuration check update progress after shared changes; failed checks keep the last authorized progress and never claim completion. Same-sheet refresh preserves editor and import draft identities and their existing conflict guards.

## Permissions and sharing

| Action | Sheet owner | Accepted member | Other user |
| --- | --- | --- | --- |
| View/edit transactions, transaction accounts, spending categories, spending groups, budgets | Yes | Yes | No |
| Preview and commit imports | Yes | Yes | No |
| Search users for invitations to this sheet | Yes | No | No |
| Invite, revoke membership, rename, delete sheet, configure budget cycle | Yes | No | No |
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
| `sheets` | Name, currency, `owner_id` referencing an auth user, monthly cycle start day, preserved baseline day, and optimistic cycle revision (defaults 1) |
| `cycle_changes` | Append-only sheet cycle revision, transition start, first recurring start, monthly day |
| `sheet_members` | Accepted non-owner members; unique `(sheet_id, user_id)` |
| `sheet_invites` | Sheet, inviter, invitee, state, timestamps; one pending invite per sheet and recipient |
| `financial_accounts` | Sheet, name, source type, archive state; no calculated balance |
| `categories` | Sheet, name, archive state; protected Uncategorized default |
| `buckets` | Sheet, spending group label, archive state; protected Unassigned default |
| `transactions` | Sheet, transaction account, date, payee, kind, signed amount, creator, timestamps, version, deletion state |
| `splits` | Sheet, transaction, signed amount, spending category, spending group; at least one per transaction |
| `budgets` | Sheet, spending category, month, nonnegative limit, version, inheritance flag; unique `(sheet_id, category_id, month)`. Removed limits retain a null limit and increasing version to reject stale create/edit/delete attempts; an explicit null is unbudgeted even when a default exists, zero is a real limit |
| `budget_defaults` | Latest recurring limit and optimistic revision per sheet/category. Null removal revisions reject stale edits |
| `budget_default_changes` | Append-only default revisions with exact effective period starts. Legacy rows baseline at 0001-01-01, including null tombstones; highest effective start and revision resolves inheritance |
| `import_batches` | Sheet, transaction account, CSV import format, normalized file hash, mapping, state, creator, timestamps |
| `import_rows` | Batch, source row position, immutable normalized source fields, optional source ID, fingerprint, decision, linked transaction |

Carry `sheet_id` through sheet-owned records and enforce same-sheet references with composite foreign keys where practical. Keep split-sum validation and atomic writes in one ledger operation. Archive used transaction accounts, spending categories, and spending groups to preserve historical references.

Deleted transactions remain as tombstones, are excluded from totals, and retain import identity. Reinstating a deleted imported transaction is explicit. Fingerprints aid lookup; they are not unique transaction constraints. Editing transaction fields never rewrites imported source identity.

## CSV import contract

Import identity is scoped to the sheet, transaction account, and canonical interpretation settings: date, description, optional source-ID columns, date and decimal formats, and all amount conventions. Display names do not change identity. Durable internal profiles have `reusable=false` and never appear among saved formats; existing profiles migrate with `reusable=true`. Historical imported identities and repeat checks use the immutable mapping on their batches, so later saved-format edits cannot combine incompatible interpretations. Original source records and tombstones survive ledger edits/deletion, and identical settings retain duplicate detection whether or not the format was remembered.

1. Use the selected sheet, choose the transaction account, upload a CSV, and choose that transaction account's saved CSV import format or configure this import. Remember this format for future imports is optional; starting review never creates a selectable saved format. Default to the last-used active transaction account and its last-used saved CSV import format in this browser, scoped to the signed-in user and sheet; fall back to the first valid option. Saved CSV import format settings are collapsed and locked until Edit CSV import format; validation still checks the current file. First-time configuration remains explicit. Selecting a saved format automatically checks the actual file and shows parsed rows. Continue to review runs any outstanding checks; there is no separate Validate action. Checking and actionable errors preserve choices. File, account, format, and configuration changes invalidate all prior check results. Required choices and missing or reused columns have guidance beside the controls. Invalid transaction rows can proceed to review for correction or exclusion. Changes to selected settings affect this import only; Update saved CSV import format explicitly saves them with its existing optimistic version checks. A saved-format conflict does not block using local choices for this import.
2. Map date, payee, amount or debit/credit columns, and optional source ID. Specify date format and sign conventions. Do not guess ambiguous dates or decimal separators.
3. Normalize into the manual-entry transaction shape. Skip records whose fields are all empty or whitespace, including exporter blank lines and delimiter-only records; retain original source row positions and file identity for duplicate detection. Partially populated rows require validation. Enforce file-size and row-count limits. Show row errors, default spending group/spending category, and proposed kinds.
4. Parsed CSV and invalid-row previews use pages of at most 10. Review defaults to 50 rows with 25/50/100 choices and navigation above and below the list. The parent review owns every raw transaction, correction, import action, and split draft by stable row ID. Inline controls use Transaction type and Import action. Closing Full review, paging, page-size changes, and explicitly loading the latest review preserve incomplete strings. Refreshing, leaving, or reopening discards pending client edits and restores persisted server review data. Explain this lifetime and warn on navigation where the browser permits. No automatic server saves or durable browser draft storage. Untouched valid rows and valid corrections need no individual acknowledgment. Counts, unresolved row guidance, readiness, and Import X transactions derive from the entire session. Corrections use the same normalization as the server. Split transaction type and allocations remain in Full review with exact shared division controls. Apply allocations creates session edits for eligible untouched kept single-part expenses/refunds across all pages. Preserve all existing row drafts and report them explicitly; no silent overwrite or mandatory row save.

5. Confirm valid kept rows with their proposed values. Recheck membership and duplicate identity against current records, then write transactions, splits, source links, and batch status in one database transaction. A stale preview returns for review rather than silently changing the approved result.

Scope matching to the transaction account and CSV import format. A matching stable source ID with unchanged source fields is a definite duplicate. Conflicting fields require review. An already committed file hash with the same mapping is a definite repeat and adds nothing.

Without stable IDs, compare immutable normalized source fields and occurrence counts. Preserve multiple identical rows in a new file as distinct purchases. Across overlapping files, matching date/payee/amount tuples and matches to manual entries are possible duplicates, not automatic exclusions. Explain the ambiguity and let the user decide.

Final Import submits accumulated edits in one protected operation. Within one immediate SQLite transaction, authorize current access, check the batch version and current ledger/configuration snapshot, normalize corrections, validate proposals and active references, recompute all duplicate matches, and create all transactions/source links/outcome atomically. Newly possible matches from changed corrections require explicit renewed Import action. Return a normalized virtual review for this re-review while rolling back proposed row edits and money writes; never persist raw pending values on a failed confirmation. Existing server matching refresh can persist independently before applying edits. Preserve client drafts after failures and conflicts. Changed row baselines require explicit Use latest values or Keep my edits against latest; renewed possible duplicates then require another choice. Do not import this row excludes its source from subsequent occurrence matching; Do not import, count this occurrence skips a valid source while retaining occurrence counting. Both create no transaction.

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

Navigation contains Overview, Transactions, Amount owed, Budgets, Import, and Settings. A secondary Switch sheet action in the navigation footer opens sheet selection and creation. Usual page URLs use the remembered authorized sheet without its ID; APIs retain explicit sheet IDs and server access checks. Owners can open Share. Incoming invitations are available independently of the selected sheet. Keep Add transaction accessible on a phone.

| Screen | Behavior |
| --- | --- |
| Registration/sign-in | Controlled registration; email or username sign-in |
| Overview | Month selection, net spending, budgets, uncategorized spending, spending group, recent transactions |
| Transactions | Add/edit/delete, filters, splits, expense/refund/income/transfer kinds |
| Amount owed | All-time tracked spending group totals, outstanding and paid expenses, repayment dates, comments, and explicit spending group selection |
| Budgets | Monthly spending category limits, actuals, remaining values, overspending |
| Import | Transaction account, mapping, validation, duplicate decisions, preview, confirmation |
| Settings | Sheet name, transaction accounts, spending categories, spending groups, members/invites, profile display name |
| Share/incoming invites | Display-name search with username disambiguation; send/accept/decline/revoke |

Keep the paper-like visual direction with a dark green accent. Build responsive forms and empty, loading, and error states with each screen. Record creator and update timestamps. Reject stale transaction and budget edits using record versions and a reload prompt instead of silently overwriting another member's changes. A full audit history is deferred.

## Verification and follow-up work

The original foundation, spending, import, budget, sharing, and release implementation sequence is historical. Use the [user-feedback implementation plan](user-feedback-implementation-plan.md) for new work and [issue tracking](issue-backlog.md) for tracker ownership.

Write focused automated tests for calculations, authorization, invitation transitions, import identity/retries, stale edits, and atomic writes. Check manual entry, splits, imports, budgets, repayments, and sharing in the actual app. Use the [release checklist](release-checklist.md) for browser, Docker persistence, and populated restore checks. Type-checking alone does not prove money or access rules. Production-specific verification remains documented in [household inputs](household-inputs.md).

## Release acceptance examples

- A $100 Groceries expense split $60 to Ethan and $40 to Parents contributes $100 to Groceries, $60 to Ethan spending group, and $40 to Parents spending group.
- A subsequent $100 card payment adds $0 spending, even when both sides appear in imported files.
- A $20 Groceries refund attributed to Ethan that month reduces Groceries spending to $80 and Ethan spending group to $40.
- A $150 Groceries limit then shows $70 remaining. A $50 limit shows $30 overspent. Income changes neither value.
- A refund the following month reduces that month's spending without changing the earlier report.
- Reimporting the same file adds nothing, even after editing or deleting imported transactions.
- Two $10 purchases with the same date and payee in a new file remain two purchases. An ambiguous match in a later file requires review.
- Failed confirmation leaves no partial transactions. Retrying successful confirmation adds nothing.
- An unrelated user cannot access a sheet by supplying its ID or attach another sheet's spending category or spending group to a split.
- Before acceptance, an invitee cannot see financial records. Repeated acceptance creates one membership. A revoked pending invite cannot be accepted. Removed members lose access on their next operation.
- Concurrent edits produce a visible conflict rather than silently losing changes.
- Fresh-volume restore recovers users, memberships, transactions, splits, budgets, and import identities, and requires sign-in again.

## Follow-up work

- Goals and savings progress
- Automatic payee categorization rules
- OFX/QFX and additional CSV profiles
- Partial repayments, per-split settlement, and repayment/comment audit history
- Transaction account balances, opening balances, reconciliation, linked transfers
- Funded envelopes, rollover, per-spending group budgets
- Ownership transfer, read-only members, full edit history
- Browser backup download/restore
- Bank connections, automatic imports, file watchers
- Multiple currencies, investments, subscription analysis, native mobile apps
- Private rows within shared sheets and member invitations

## Household inputs for implementation

These choices refine the release without expanding scope:

Confirmed decisions, delegated label choices, remaining questions, and the explicitly unconfirmed synthetic CSV candidate are recorded in [Household implementation inputs](household-inputs.md). The household-inputs issue remains open until the actual export conventions and production deployment/backup targets are known.

- Which CSV exports must work first, including date, amount, and source-ID fields?
- Which currency and spending group labels should the initial sheets use?
- Will access use a private network or an HTTPS endpoint? Deployment instructions must match that choice.

## Reference notes

Better Auth's [database schema](https://better-auth.com/docs/concepts/database) owns credentials and sessions. Its [username plugin](https://better-auth.com/docs/plugins/username) adds username sign-in to email/password authentication; registration still requires email.

When a changed monthly anchor clamps to an existing boundary, the shorter-period choice derives an aligned boundary instead. The preceding period remains completely unchanged, even when already completed. The revision starts at the effective date itself, with transitionFrom equal to recurringFrom. The first recurring period retains its exact-start override; subsequent overrides map to corresponding successor months. Preview labels the unchanged preceding period, lists its retained limits, and includes the effective-start override in the attachment mapping. An aligned change to the same configured day is rejected as a no-op. Explicit longer transitions remain intentional extensions.
