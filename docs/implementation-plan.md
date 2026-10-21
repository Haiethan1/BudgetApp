# Homebooks MVP implementation plan

For the approved user-feedback follow-up covering issues #29–40, see the [user-feedback implementation plan](user-feedback-implementation-plan.md) for implementation order, dependencies, shared components, and validation gates. It describes planned extensions, not shipped behavior.

Homebooks is a self-hosted household app for tracking spending against monthly spending category limits, with expense allocation by person or group. Users enter transactions manually or import CSV files. The app stores no bank credentials.

This document defines implemented behavior and release gates, including the improvements merged in PR #28. Planned changes from issues #29–40 remain separate until implemented. The repository now implements the app; see the [README](../README.md), [release acceptance procedure](release-checklist.md), and [deployment guide](deployment-guide.md) for current usage and verification. Unconfirmed production inputs remain in [household inputs](household-inputs.md).

Review the editable [system design diagram](system-design.excalidraw) alongside this plan. Its three panels cover runtime and operations, sheet data and calculations, and import and sharing workflows. Open the file in Excalidraw to pan between panels and edit it. The [image preview](system-design-preview.png) stacks the same panels vertically for reading without an editor.

The [website specification](website-spec.md) defines layouts, visual tokens, responsive behavior, and interaction states. The [visual reference](website-reference.html) illustrates representative screens. UI implementation and agent handoffs follow those references alongside this plan.

## MVP decisions

- Each person has one login. Every user can create sheets and becomes the owner of each sheet they create.
- A sheet contains transaction accounts, transactions, spending categories, people and groups, and monthly budgets. Personal and Family are separate sheets.
- Sharing grants access to the whole sheet. Only the owner can invite people or revoke access.
- Owners search existing users by display name. Results also show a unique username to distinguish people with the same name. Invitations target stable user IDs.
- Invitees can see invitations but cannot open a sheet until acceptance.
- People and groups identify whose expense a split represents. Use shared spending-group names such as Ethan, Parents, and the default Me. Me is a fixed label for the sheet’s default card-user allocation; it does not switch identity with the signed-in viewer. Responsibility does not require that person to have a login.
- People and groups describe whose spending each expense belongs to. They do not require a login and are distinct from Sharing, which controls login access. Repayments supports opt-in automatic expense tracking by person or group and standalone agreements. Assigning a group creates a debt only when repayment tracking has been explicitly enabled with a recipient. People and groups are not cash balances or savings envelopes.
- Budgets are monthly limits for spending categories. They include all people and groups on the sheet and do not roll over.
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
5. One spending calculation supplies Overview and Budgets. Reports group the same expense and refund splits by person or group.
6. Sharing checks the actor, invitation state, and current ownership before changing access.

Authorize every server read and mutation. Hidden buttons and the sheet switcher are not access controls. Reject references to another sheet's transaction account, spending category, person or group, transaction, or import batch. Recheck authorization when committing an import or accepting an invitation.

## Money and calculation rules

Store amounts as signed integers in the sheet currency's minor units. Parse decimal input without floating-point arithmetic and reject values outside the supported integer range. Outflows are negative and inflows are positive. For USD, a $100 purchase is `-10000`.

Use date-only `YYYY-MM-DD` transaction dates and exact `YYYY-MM-DD` period-start budget keys. Spending belongs to the sheet's recurring monthly cycle containing the transaction's effective date, independent of the server timezone. A refund reduces spending in the refund's cycle, even if the purchase occurred earlier.

| Kind | Amount | Effect on spending category spending |
| --- | --- | --- |
| Expense | Negative | Adds spending through its spending category splits |
| Refund | Positive | Reduces spending through its spending category splits |
| Income | Positive | Excluded |
| Transfer | Positive or negative | Excluded, including credit-card payments |

Every transaction has at least one split. Ordinary transactions have one split for the entire amount. Every split has a spending category and person or group from the same sheet and uses the parent's sign. Split amounts sum exactly to the parent. Reject zero amounts and mixed-sign splits in this MVP. Validate the entire transaction on create, edit, and import confirmation.

Transactions also have optional plain-text notes up to 2000 characters, independent of descriptions and legacy repayment comments. Migration 0019 gives historical transactions empty notes without changing their allocations, import identities or repayment histories. Manual and import proposal drafts retain notes; workbook Transactions rows include them as literal strings. An update omitting notes preserves the saved value; an explicit empty string clears it.

Ordinary transaction create/edit HTTP requests require a UUID request ID. In one immediate transaction, current sheet access is checked before replay, then a hash binds the ID to actor, create/edit target and parsed payload. Successful writes store the original full response snapshot alongside the ledger write. Exact retries return that snapshot without writing again, even if the transaction has since changed or been deleted; reusing an ID with different inputs conflicts. Internal service calls without a request ID remain available for existing batch imports, whose enclosing commit provides retry protection. Unknown manual save outcomes retain and lock the exact payload/request until Retry same save resolves the result. Migration 0019 request records are included in normal database backups.

Ledger list responses include net expense/refund spending and per-person totals over every transaction matching the same account, inclusive date, payee, kind, category, person and batch predicates as the rows. Pagination never changes those totals. Category/person filters select whole transactions and totals include all of their shares; income/transfers contribute zero. One read snapshot supplies counts, rows and summaries. BigInt accumulation rejects totals outside the supported safe integer range without rounding intermediate cancellations.

The Expenses grid uses an explicit expenses-only list view containing both expenses and refunds. All transactions and existing kind filters remain available. Its positive-purchase/negative-refund input is translated once to the existing signed ledger contract. Row drafts remain atomic and raw until balanced; hidden columns never change spending. Simple share edits preserve categories and unaffected split ordering. Changed totals spanning multiple categories or archived allocations require explicit detailed allocation, with the requested totals retained as guidance. Browser column preferences are per-user/per-sheet and do not alter shared people or repayment configuration. Expense totals remain recorded actuals; plan/budget and debt calculations are unchanged.

Create a protected Uncategorized spending category and Me person or group on each new sheet. New manual and imported transactions default to Me. Migration 0017 preserves historical Unassigned allocations by archiving the old group, then creates or reuses Me as the protected default. Reused Me groups stop automatic repayment tracking; existing debts/history stay intact. Existing custom name casing is retained. No transaction allocation IDs or amounts change. Imported expenses use those defaults until edited. Income and transfers also have a split, but their splits do not contribute to spending. Uncategorized expenses remain visible in Overview.

Spending category spending is the negated sum of expense and refund splits for that spending category and month. Remaining budget equals its period limit minus budget used. Budget used includes the upcoming-payment planning adjustments defined below; recorded spending remains the unmodified expense/refund total. A $100 expense and $20 refund yield $80 spending. Negative remaining values show overspending; do not clamp them to zero.

Each spending category can have a recurring default limit. Changes apply from the current UTC budget period onward to periods without an explicit override. Earlier periods retain their effective defaults and spending comparisons. Existing monthly limits remain overrides. A month can override the amount, explicitly remove the limit, or return to the default. Default changes preserve current and future explicit overrides unless the user explicitly chooses to replace the current override. Migration 0013 baselines all existing defaults, including null removal revisions, so upgrading changes no report. Append-only effective-period revisions retain history; repeated current changes take effect at that same exact period start. Both defaults and overrides use optimistic revisions; setting a default from the monthly dialog is atomic.

Overview shows net spending, spending against budgeted spending categories, uncategorized spending, person or group totals, and recent transactions. Label any combined remaining value as remaining for budgeted spending categories. Spending categories without limits still contribute to total spending. There is no safe-to-spend balance. Amount owed is a separate all-time expense repayment view.

Card purchases are expenses; card payments are transfers. Importing both checking and card files must not count the payment as another expense. Preview proposes kinds and highlights card payments as Transfers. Users can change kinds that cannot be inferred reliably. Valid rows import with their proposed values and protected spending category/person or group defaults without individual review or saving. A valid source correction is also importable immediately unless its duplicate matching requires an explicit decision. Pairing transfer rows and double-entry accounting are deferred.

## Upcoming payment plans

Owners and accepted members can create an upcoming payment plan with name, positive expected amount, upcoming due date, spending category and recurrence. Recurrence choices are one payment, monthly, every six months and annually. Plans never prove money was saved or moved, create transactions, establish debt, or infer a match.

Planning begins in the current UTC sheet period at creation. Its schedule includes every remaining authoritative period through the period containing the due date. A due date exactly on a period boundary includes that new period. Divide expected minor units by the number of periods; give one extra unit to the earliest periods until the remainder is exhausted. The contribution rows sum exactly to the expected amount. Six periods toward $600 receive $100 each. Twelve periods toward $395 receive eight contributions of $32.92 and four of $32.91. Starting late divides the amount over fewer periods and shows their exact dates and amounts.

Completed contribution rows retain their category, amount and period dates. Editing rebuilds only current and future rows from expected amount minus completed contributions. Reject an expected amount below completed contributions and a category change after any completed contribution. Cancel or skip removes current/future rows and releases completed contributions with a negative reconciliation in the current period. Earlier rows remain unchanged. An overdue plan keeps its original schedule without extra contributions or automatic spending. Changing sheet cycles previews old/new active schedules, retains completed rows and divides the remaining target across the new unfinished periods. Plan revisions participate in the cycle preview digest and atomic save.

Recorded spending always uses full ledger amounts and actual dates. Category budget used equals recorded spending plus Planned contributions plus reconciliation minus matched expense excluded. Remaining equals the effective period limit minus this budget used. Overview and Budgets expose all four components; net spending and Responsibility totals remain recorded actuals. Categories without limits still show their planning breakdown.

Matching is explicit and supports a whole expense only. Every split must have the plan's spending category; People and groups may differ. One transaction can fulfill at most one active plan. A payment must be dated in the actual current UTC period, on or after the plan creation date and no later than today. It must also have been recorded at or after the plan's creation timestamp, so an expense entered earlier the same day is ineligible. Historical or pre-plan payments are never redistributed.

Matching stops future contributions. Its payment-period reconciliation equals actual amount minus all retained contributions, including the current contribution when present. Early fulfillment therefore adds uncovered cost in that period. A late payment retains every completed contribution and adds only the difference in the payment period. Underpayment may produce a negative reconciliation. The transaction itself keeps its full amount, date and splits. No second transaction is created.

The match stores original amount/date/payee/category/revision. Later source changes, deletion, kind conversion or reallocation require review. Until release, the original plan charge remains and live expense portions are excluded at their current categories/dates. Nonexpense/deleted sources have no expense exclusion. Release removes the active claim, cancels the plan and reverses all retained plan charge in the current period while preserving completed contribution history. Actual spending then counts normally; the payment may explicitly fulfill another eligible plan. Separate refunds reduce recorded spending normally and never infer a match or revise a plan.

A fulfilled plan proposes its next upcoming recurrence, with the original intended day retained through short-month clamping. Past proposed dates are skipped visibly. Confirming creates a separate new plan starting today with editable amount/date/category/recurrence. Due dates alone never create records. A cancelled, skipped, released or unresolved-source plan cannot propose another occurrence.

Plan mutations recheck sheet access, current UTC period, cycle revision, plan revision and relevant source revision in one immediate transaction. Exact request IDs and payload hashes make retries idempotent. A released source has at most one new active claim; prior match snapshots remain. Unknown save outcomes lock the draft until the exact action is retried; conflicts preserve fields until explicit discard/reload. Migration 0015 adds plans, contribution history, reconciliation and request records without changing existing ledger or budget rows. Backups and restores include all plan records.

## Sheet-wide budget cycles

Each sheet has one recurring monthly start day across every account. Owners choose a day and can optionally check Only affect future cycles. The default unchecked choice applies the day to all cycles, including current and historical reporting, so a cycle can be corrected mid-month. It replaces prior schedule transitions with one recurring schedule. Transactions retain their original dates and amounts; Overview, Budgets and ledger filtering regroup them using the same date-only resolver. Short months clamp the chosen day independently, including leap years. UTC determines today and the current period. Supported dates remain 0001-01-01 through 9999-12-31.

Only affect future cycles retains the current period and every earlier boundary. The next period begins the day after the current period ends; a short initial period connects that boundary to the new monthly start when necessary. Earlier schedule revisions stay effective; pending future revisions are replaced by the newly selected schedule.

Saved category overrides retain exact limits, explicit zero, no-limit choices, inheritance flags and versions. All-period changes map each override to the new recurring start in its existing calendar month. Future-only changes leave current/earlier overrides in place and map later ones to the new schedule, clipped to the first future boundary. If two stored overrides would collide, reject atomically and offer future-only application rather than silently dropping a limit. Default revision effective dates follow the same mapping; the year-1 baseline remains at 0001-01-01. No limits are prorated. Existing exact-start links resolve through the new schedule; period writes still require current cycle versions.

Upcoming payment plans keep their exact retained contribution amounts. All-period changes remap completed contributions to the new month starts, summing exact minor units if periods meet, then rebuild active unfinished schedules from the remaining expected amount. Future-only changes preserve completed and current contributions and rebuild only later ones. Fulfilled/cancelled plan contributions remain represented under the new reporting dates. Adjustment and transaction dates remain unchanged. Plan versions change so stale drafts cannot overwrite replanning.

The settings API uses an authorized server check followed by an optimistic atomic save on one button click. The digest covers the schedule, all overrides/default revisions and plan records/contributions. Changed versions or preview inputs require reloading, with unsaved UI choices preserved. Owners alone can change schedules. The prior explicit-transition operation remains available for existing clients; the current UI uses the simplified all-period/future-only control.

## Amount owed and repayment tracking

Amount owed combines opt-in spending-group expense tracking with standalone agreements, independent of the selected budget period. Owners and accepted members can create standalone obligations or group selected expense transactions, split portions and existing debts. Each agreement has a description, debtor and recipient names chosen from people and groups, agreed total, immutable repayment history, calculated paid and remaining amounts, and last-updated time. Party names need no login and are distinct from sheet membership. Both party dropdowns use active people and groups and preserve the current saved name during edits. Add person or group reveals a name field and creates the group atomically with the agreement or tracking save. Names use the same normalized uniqueness rules as Settings; existing group casing is reused, including safe retries. Failed saves create no group. The Repayments table keeps debtor and recipient explicit on every row without merging histories. All-matching direction aggregates include records on other pages; opposite directions remain separate. Owners and accepted members can enable repayment tracking for custom people and groups with an explicit repayment recipient. Enabling includes existing live expense portions and future manual/imported expenses. Only the tracked group’s portion counts, using the group name as debtor and its configured recipient. New sheets track no groups. Legacy tracked groups without a recipient require configuration before automatic additions resume. Tracking changes preserve existing debts and payments; recipient changes affect newly added debts, and disabling stops new additions without removing history. Re-enabling backfills unclaimed expenses without duplicates. Group configuration uses optimistic tracking versions and idempotent request IDs. Protected Me cannot be tracked. Refunds, income, transfers and deleted transactions do not create debts. Ledger edits preserve claimed totals and flag review; transactions with changed claimed portions cannot acquire new automatic claims. These rules apply atomically in the shared manual/import transaction writer. Migration 0016 adds nullable bucket repayment recipients and tracking request records without changing existing debts or enabling any new group.

All amounts use the sheet currency's exact minor units and supported integer range. New totals and repayments are positive. An optional, explicitly labeled opening amount already repaid creates an opening history event with its own date/comment. Paid so far is the sum of recorded events; remaining is agreed total minus paid. Partial payments remain Outstanding until remaining reaches zero. Completion is the latest effective original or corrected repayment date. Dates are explicit date-only records and may precede a source expense or be future dates. A source cancellation with zero total and no effective payments completes on the agreement's update date. Debt and repayment actions never create expenses, refunds, balances, bank synchronization or ledger links. Any future ledger-linking requires a separately designed explicit action and duplicate protection.

Repayments cannot exceed remaining. Corrections choose an original payment or opening event, supply its replacement nonnegative amount/date/comment and a mandatory reason, and append the delta from that event's currently effective amount. Zero voids the event. Corrections do not target other correction events; repeated corrections derive from the latest effective original event. Original history remains inspectable. Net paid cannot be negative or exceed the agreed total. Correct payments before reducing an agreement below paid so far.

Grouping requires a source preview and explicit confirmation of debtor, recipient and combined total. Selecting a whole expense claims every split; selecting a portion claims that portion. A portion has one exclusive owner. Existing debts must have matching explicit parties and resolved source reviews before grouping. Grouping atomically transfers their sources and payment history into the new agreement, archives the replaced debts and counts the amounts once. Standalone amounts in groups remain part of the agreed total during source revisions. Grouping never changes transaction or spending data.

Expenses also offers Track period amount. Its explicit person, recipient, account (or All accounts), and inclusive dates define the entire server-side discovery scope, independently of pagination, search, category and import filters. The preview lists every eligible unclaimed expense portion and existing agreement with the same direction whose linked portions all belong to that person and scope. Existing partial and completed agreements retain their original gross amounts and payment history. Standalone amounts, mixed or out-of-scope agreements, other directions, missing recipients, unresolved source reviews and edited-claim restrictions are excluded with explanations. The user can inspect and deselect entries. All candidates remain visible beyond the 500-linked-portion mutation limit; the user must select a smaller group rather than accepting a truncated set.

Period spending (gross purchases, refunds and net spending) is separate from the selected original gross obligation, paid back and remaining. Refunds never reduce this grouped debt automatically; any refunds in scope require the explicit acknowledgement “Track gross expenses; refunds remain separate.” Negative net spending is still spending context, never a negative obligation. The preview carries a digest of scope, current organization, sources, claims, agreement revisions and repayment totals. Confirmation revalidates the complete discovery snapshot inside the existing immediate grouping transaction before writing, detecting new candidates as well as edits, claims and payments. A mismatch requires an explicit discard-and-reload. Successful exact request replay occurs before preview revalidation so a lost response remains safely recoverable after grouping has changed the candidates. Unknown outcomes lock the original payload and request ID until Retry same action resolves them. No new schema or separate grouping writer is required.

Sources retain original transaction ID, split position, original amount/date/payee/group and original/acknowledged transaction revisions. Transaction editors replace split IDs, so those IDs do not establish durable economic identity. Any later transaction edit, kind conversion, refund conversion or deletion flags linked agreements for review and leaves their agreed totals intact. Keep agreed acknowledges the current revision or tombstone and records a reason without changing the agreement. Adopt current previews and explicitly replaces the linked contribution with the current portion amount, zero when deleted or no longer an expense. Because edited split positions may represent different allocations, the current transaction is inspectable before confirmation. Adoption may cancel the agreement to zero but cannot reduce it below paid. Original snapshots remain inspectable after either choice. Separate refund transactions have no inferred link and never repay or revise debts automatically.

After any source transaction revision changes, new portion claims on that transaction remain blocked, including after review acknowledgment. This conservative rule prevents a moved or replaced portion from being counted twice when no stable economic split identity exists. Users can group its existing agreements. Standalone entries represent independently agreed obligations and are not a workaround for copying already claimed source amounts.

Migration 0014 creates one agreement per existing live expense split in explicitly tracked groups, including archived groups and repeated group portions. It preserves the original owed amounts, source links, tracked selections and updated times. A legacy whole-expense paid date becomes an explicitly labeled opening repayment for each included allocation, preserving its comment/date and total without duplicating untracked allocations. Every migrated agreement has the person or group's debtor label and an unresolved recipient shown as Needs clarification. No viewer-dependent recipient is guessed. Untracked, deleted and non-expense transactions do not become debts. Legacy dated/comment metadata for all transactions is archived separately and remains inspectable from the ledger or debt source page. The old whole-expense paid-date/comment and legacy group-tracking mutation endpoints are retired; new repayments use only debt history. Changing a transaction kind can clear its obsolete transaction date field without losing archived metadata.

All mutations authorize current sheet access and use optimistic agreement/source versions inside an immediate atomic transaction. A request UUID plus canonical request hash protects creates, payments, corrections, grouping and review from duplicate retries. Reusing a key with different inputs conflicts. Unknown network outcomes preserve the original request and offer Retry same action before allowing edits. Conflicts preserve drafts and require explicit discard-and-reload. The Repayments page defaults to Unpaid, including unpaid and partial agreements across all dates, ten per page. All includes every active agreement across all dates; Paid uses explicit completion-date bounds with access to all older history. Matching totals are independent of pagination. Who owes? selects an exact stored debtor name across all recipients; completed-only names remain selectable. Direction stays explicit on each agreement and unknown legacy recipients require clarification. Totals are gross remaining debt without netting opposite directions and remain separate from spending totals.

Paid back initially shows the latest ten completed agreements in the inclusive UTC range from today minus three calendar months through today. Calendar subtraction clamps to the target month's last day. Completion is the latest nonvoid effective opening/payment date after corrections; a correction replaces its target's date and amount and can reopen an agreement. Zero-total adopted agreements without nonvoid repayments use the latest adoption's UTC date. Adopting a nonzero total equal to paid retains the latest effective repayment date. Completion ordering is descending date then ascending stable ID.

History date controls filter completion dates and apply on Load history. Blank start/end bounds allow all older history; reversed ranges are rejected. Requests reject sizes above 100, Outstanding always uses ten, and the UI pages both lists ten at a time with complete matching counts and More matches available. SQL aggregates and bounded page summaries avoid loading every agreement or repayment into the client; opening a drawer explicitly fetches one agreement's history. Person and grouping selections survive paging. The active repayment view maintains loading/error/empty states, hides prior results on query changes, rejects stale async successes/errors and refreshes after mutations. Bounded summary rows include the latest effective nonvoid repayment date and note-presence flag, while histories remain on-demand reads. No schema change was needed for this browsing contract.

## Sheet setup guidance

A fresh sheet offers Start setup with two tasks: choose or add an active transaction account, then enter one transaction or import a CSV. The account step uses the same real account form as manual entry. The entry step opens the real transaction editor or file/mapping/review/import workflow with the chosen account. Protected Uncategorized and Me allocations, the existing cycle, no limits, and no reusable CSV format are valid defaults. Categories, responsibility names, budgets, cycles, and saved formats remain optional under Optional settings.

Setup completion is a shared durable sheet fact. A successful transaction write, including a nonempty committed import, marks it complete atomically. Failed writes, zero-added imports, skipping guidance, and custom configuration alone do not complete a new sheet. Existing completion flags remain unchanged, including flags established before this guide. Migration 0018 continues to preserve historical transaction completion. Reads derive configuration counts but never mutate completion. Later deletion or archiving does not reset completion.

Personal guide progress is independent of shared setup. Browser local storage uses stable user ID plus sheet ID and retains the active step, selected account/path, Skip setup, and verified first-entry result across navigation, reload, new tabs, and later logins in the same browser. It stores no credentials. If storage is unavailable, memory retains state during client navigation. A removed or archived selected account returns the guide to the account task. Page Help always offers Resume setup while the sheet is unfinished, including after Skip setup; reopening never resets configuration. Complete sheets still have optional page Help and next actions.

Verified manual creation and committed import results, including status recovery after an uncertain import, show the recorded result and View transactions. Only imports with added rows produce first-entry success. Done or viewing the result dismisses this personal completion panel. If another member completes the sheet, an active guide truthfully states that the sheet has its first transaction. Navigation, focus and the existing authorized background check refresh shared facts; failed checks do not claim completion. Real forms retain drafts through errors, pending operations and existing conflict/navigation guards. Members may add accounts and transactions; only owners see cycle customization.

## Permissions and sharing

| Action | Sheet owner | Accepted member | Other user |
| --- | --- | --- | --- |
| View/edit transactions, transaction accounts, spending categories, people and groups, budgets | Yes | Yes | No |
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
| `buckets` | Sheet, person or group label, archive state; protected Me default |
| `transactions` | Sheet, transaction account, date, payee, kind, signed amount, creator, timestamps, version, deletion state |
| `splits` | Sheet, transaction, signed amount, spending category, person or group; at least one per transaction |
| `budgets` | Sheet, spending category, month, nonnegative limit, version, inheritance flag; unique `(sheet_id, category_id, month)`. Removed limits retain a null limit and increasing version to reject stale create/edit/delete attempts; an explicit null is unbudgeted even when a default exists, zero is a real limit |
| `budget_defaults` | Latest recurring limit and optimistic revision per sheet/category. Null removal revisions reject stale edits |
| `budget_default_changes` | Append-only default revisions with exact effective period starts. Legacy rows baseline at 0001-01-01, including null tombstones; highest effective start and revision resolves inheritance |
| `import_batches` | Sheet, transaction account, CSV import format, normalized file hash, mapping, state, creator, timestamps |
| `import_rows` | Batch, source row position, immutable normalized source fields, optional source ID, fingerprint, decision, linked transaction |

Carry `sheet_id` through sheet-owned records and enforce same-sheet references with composite foreign keys where practical. Keep split-sum validation and atomic writes in one ledger operation. Archive used transaction accounts, spending categories, and people and groups to preserve historical references.

Deleted transactions remain as tombstones, are excluded from totals, and retain import identity. Reinstating a deleted imported transaction is explicit. Fingerprints aid lookup; they are not unique transaction constraints. Editing transaction fields never rewrites imported source identity.

## CSV import contract

Import identity is scoped to the sheet, transaction account, and canonical interpretation settings: date, description, optional source-ID columns, date and decimal formats, and all amount conventions. Display names do not change identity. Durable internal profiles have `reusable=false` and never appear among saved formats; existing profiles migrate with `reusable=true`. Historical imported identities and repeat checks use the immutable mapping on their batches, so later saved-format edits cannot combine incompatible interpretations. Original source records and tombstones survive ledger edits/deletion, and identical settings retain duplicate detection whether or not the format was remembered.

1. Use the selected sheet, choose the transaction account, upload a CSV, and choose that transaction account's saved CSV import format or configure this import. Remember this format for future imports is optional; starting review never creates a selectable saved format. Default to the last-used active transaction account and its last-used saved CSV import format in this browser, scoped to the signed-in user and sheet; fall back to the first valid option. Saved CSV import format settings are collapsed and locked until Edit CSV import format; validation still checks the current file. First-time configuration remains explicit. Selecting a saved format automatically checks the actual file and shows parsed rows. Continue to review runs any outstanding checks; there is no separate Validate action. Checking and actionable errors preserve choices. File, account, format, and configuration changes invalidate all prior check results. Required choices and missing or reused columns have guidance beside the controls. Invalid transaction rows can proceed to review for correction or exclusion. Changes to selected settings affect this import only; Update saved CSV import format explicitly saves them with its existing optimistic version checks. A saved-format conflict does not block using local choices for this import.
2. Map date, payee, amount or debit/credit columns, and optional source ID. Specify date format and sign conventions. Do not guess ambiguous dates or decimal separators.
3. Normalize into the manual-entry transaction shape. Skip records whose fields are all empty or whitespace, including exporter blank lines and delimiter-only records; retain original source row positions and file identity for duplicate detection. Partially populated rows require validation. Enforce file-size and row-count limits. Show row errors, default person or group/spending category, and proposed kinds.
4. Parsed CSV and invalid-row previews use pages of at most 10. Review defaults to 50 rows with 25/50/100 choices and navigation above and below the list. The parent review owns every raw transaction, correction, import action, and split draft by stable row ID. Inline controls use Type and Import?. Closing Details, paging, page-size changes, and explicitly loading the latest review preserve incomplete strings. Refreshing, leaving, or reopening discards pending client edits and restores persisted server review data. Explain this lifetime and warn on navigation where the browser permits. No automatic server saves or durable browser draft storage. Untouched valid rows and valid corrections need no individual acknowledgment. Counts, unresolved row guidance, readiness, and Import X transactions derive from the entire session. Corrections use the same normalization as the server. Split transaction type and allocations remain in Details with exact shared division controls. Apply allocations creates session edits for eligible untouched kept single-part expenses/refunds across all pages. Preserve all existing row drafts and report them explicitly; no silent overwrite or mandatory row save.

5. Confirm valid kept rows with their proposed values. Recheck membership and duplicate identity against current records, then write transactions, splits, source links, and batch status in one database transaction. A stale preview returns for review rather than silently changing the approved result.

Scope matching to the transaction account and CSV import format. A matching stable source ID with unchanged source fields is a definite duplicate. Conflicting fields require review. An already committed file hash with the same mapping is a definite repeat and adds nothing.

Without stable IDs, compare immutable normalized source fields and occurrence counts. Preserve multiple identical rows in a new file as distinct purchases. Across overlapping files, matching date/payee/amount tuples and matches to manual entries are possible duplicates, not automatic exclusions. Explain the ambiguity and let the user decide.

Final Import submits accumulated edits in one protected operation. Within one immediate SQLite transaction, authorize current access, check the batch version and current ledger/configuration snapshot, normalize corrections, validate proposals and active references, recompute all duplicate matches, and create all transactions/source links/outcome atomically. Newly possible matches from changed corrections require explicit renewed Import? choice. Return a normalized virtual review for this re-review while rolling back proposed row edits and money writes; never persist raw pending values on a failed confirmation. Existing server matching refresh can persist independently before applying edits. Preserve client drafts after failures and conflicts. Changed row baselines require explicit Use latest values or Keep my edits against latest; renewed possible duplicates then require another choice. The Import? control maps Import to keep, Skip to exclude, and Skip, keep matching count to skip. Skip excludes its source from subsequent occurrence counts; Skip, keep matching count skips a valid source while retaining occurrence counting. Both create no transaction. Stable-ID protections remain unchanged. Every possible overlap requires an explicit choice even when incoming occurrence count exceeds existing matches.

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

Primary navigation contains Expenses, Repayments and Settings. Import CSV launches from Expenses; Settings > Optional tools links to Overview, Budgets, payment planning and category administration. A secondary Switch sheet action in the navigation footer opens sheet selection and creation. Usual page URLs use the remembered authorized sheet without its ID; APIs retain explicit sheet IDs and server access checks. Owners can open Share. Incoming invitations are available independently of the selected sheet. Keep Add transaction accessible on a phone.

| Screen | Behavior |
| --- | --- |
| Registration/sign-in | Controlled registration; email or username sign-in |
| Overview | Month selection, net spending, budgets, uncategorized spending, person or group, recent transactions |
| Expenses | Add/edit/delete, filters, splits, expense/refund/income/transfer kinds |
| Repayments | Explicit standalone and grouped debts, direction, source review, partial repayments and preserved history |
| Budgets | Monthly spending category limits, actuals, remaining values, overspending |
| Import | Transaction account, mapping, validation, duplicate decisions, preview, confirmation |
| Settings | Sheet name, transaction accounts, spending categories, people and groups, members/invites, profile display name |
| Share/incoming invites | Display-name search with username disambiguation; send/accept/decline/revoke |

Keep the paper-like visual direction with a dark green accent. Build responsive forms and empty, loading, and error states with each screen. Record creator and update timestamps. Reject stale transaction and budget edits using record versions and a reload prompt instead of silently overwriting another member's changes. A full audit history is deferred.

## Verification and follow-up work

The original foundation, spending, import, budget, sharing, and release implementation sequence is historical. Use the [user-feedback implementation plan](user-feedback-implementation-plan.md) for new work and [issue tracking](issue-backlog.md) for tracker ownership.

Write focused automated tests for calculations, authorization, invitation transitions, import identity/retries, stale edits, and atomic writes. Check manual entry, splits, imports, budgets, repayments, and sharing in the actual app. Use the [release checklist](release-checklist.md) for browser, Docker persistence, and populated restore checks. Type-checking alone does not prove money or access rules. Production-specific verification remains documented in [household inputs](household-inputs.md).

## Release acceptance examples

- A $100 Groceries expense split $60 to Ethan and $40 to Parents contributes $100 to Groceries, $60 to Ethan person or group, and $40 to Parents person or group.
- A subsequent $100 card payment adds $0 spending, even when both sides appear in imported files.
- A $20 Groceries refund attributed to Ethan that month reduces Groceries spending to $80 and Ethan person or group to $40.
- A $150 Groceries limit then shows $70 remaining. A $50 limit shows $30 overspent. Income changes neither value.
- A refund the following month reduces that month's spending without changing the earlier report.
- Reimporting the same file adds nothing, even after editing or deleting imported transactions.
- Two $10 purchases with the same date and payee in a new file remain two purchases. An ambiguous match in a later file requires review.
- Failed confirmation leaves no partial transactions. Retrying successful confirmation adds nothing.
- An unrelated user cannot access a sheet by supplying its ID or attach another sheet's spending category or person or group to a split.
- Before acceptance, an invitee cannot see financial records. Repeated acceptance creates one membership. A revoked pending invite cannot be accepted. Removed members lose access on their next operation.
- Concurrent edits produce a visible conflict rather than silently losing changes.
- Fresh-volume restore recovers users, memberships, transactions, splits, budgets, and import identities, and requires sign-in again.

## Follow-up work

- Goals and savings progress
- Automatic payee categorization rules
- OFX/QFX and additional CSV profiles
- Automatic ledger-linked debt settlements and bank balances
- Transaction account balances, opening balances, reconciliation, linked transfers
- Funded envelopes, rollover, per-person or group budgets
- Ownership transfer, read-only members, full edit history
- Browser backup download/restore
- Bank connections, automatic imports, file watchers
- Multiple currencies, investments, subscription analysis, native mobile apps
- Private rows within shared sheets and member invitations

## Household inputs for implementation

These choices refine the release without expanding scope:

Confirmed decisions, delegated label choices, remaining questions, and the explicitly unconfirmed synthetic CSV candidate are recorded in [Household implementation inputs](household-inputs.md). The household-inputs issue remains open until the actual export conventions and production deployment/backup targets are known.

- Which CSV exports must work first, including date, amount, and source-ID fields?
- Which currency and person or group labels should the initial sheets use?
- Will access use a private network or an HTTPS endpoint? Deployment instructions must match that choice.

## Reference notes

Better Auth's [database schema](https://better-auth.com/docs/concepts/database) owns credentials and sessions. Its [username plugin](https://better-auth.com/docs/plugins/username) adds username sign-in to email/password authentication; registration still requires email.

When a changed monthly anchor clamps to an existing boundary, the shorter-period choice derives an aligned boundary instead. The preceding period remains completely unchanged, even when already completed. The revision starts at the effective date itself, with transitionFrom equal to recurringFrom. The first recurring period retains its exact-start override; subsequent overrides map to corresponding successor months. Preview labels the unchanged preceding period, lists its retained limits, and includes the effective-start override in the attachment mapping. An aligned change to the same configured day is rejected as a no-op. Explicit longer transitions remain intentional extensions.

## Manual spreadsheet export

Owners and accepted members can download the selected sheet from Settings > Export sheet as one Excel workbook. All data includes every live transaction and split, effective budget/default/override records, all debts and immutable repayment events, source snapshots and agreement changes. No UI pagination or repayment-history limit applies. This export contains no credentials, login profiles, or other sheets. It is not an instance backup.

An explicit range includes both dates. Transactions and splits use transaction date. Repayment events use their own event dates; an original event needed by an included correction is retained and marked Context only if outside the range. Debts, direction, agreed total, paid and remaining are current all-time snapshots regardless of range. Grouped child debts remain marked with their replacement debt ID and excluded from active totals. Debt sources and agreement changes remain all-time context, including original/deleted/out-of-range source snapshots.

Budgets include each complete authoritative period overlapping the range, its exact inclusive boundaries, category, effective default, override/inheritance choice, zero/no-limit state, recorded spending, Planned contributions, reconciliation, matched expense excluded, budget used and remaining. These full-period calculations may include transactions outside the selected transaction range. All data uses a finite period extent spanning recorded transactions, overrides, nonbaseline default revisions, planning contributions/adjustments and the current period. Migration defaults effective at 0001-01-01 remain in history but do not create thousands of empty inherited periods. Future inherited periods without records are not expanded. Default history and stored overrides remain contextual configuration independent of the range. Budget sums use exact integers, including aggregate values above a single-record supported limit.

One SQLite read transaction checks current sheet access and reads every dataset. Metadata states sheet ID/name, currency/precision, UTC generation time, scope, period coverage, dataset semantics and row counts. Empty datasets have zero metadata counts and no empty tabs. Excel worksheet, cell and workbook size limits fail explicitly instead of silently trimming or truncating records.

Transaction totals occur only in Transactions. Splits contains split amounts with stable transaction and split IDs, spending category and person or group labels, including archived labels. Money has exact decimal and minor-unit text companions. The numeric amount is blank when its absolute minor-unit value exceeds 15 digits, because Excel cannot safely preserve those numbers. Null limits remain distinct from explicit zero. Date-only values stay YYYY-MM-DD text. All descriptions and names are literal spreadsheet string cells, never formulas; standard OOXML escapes preserve unsupported control characters. Header rows are frozen and filtered, with readable column widths and header styling. Open in Excel or import into Google Sheets manually. Direct account integration and automatic synchronization remain deferred.

The Legacy repayment metadata tab retains every selected-sheet archived whole-expense repayment date/comment from debt_legacy_metadata, including transactions never tracked as debt and deleted or out-of-range transactions. These rows are always contextual and never create debts or add to repayment amounts. Stable transaction IDs and current exists/date/kind/deleted/included-in-summary flags explain records absent from the Transactions tab. The original archived repayment date and comment remain unchanged. Date-range filtering does not remove this metadata.

## CSV entry through Expenses

Import CSV preserves its mapping, saved formats, source occurrence identity, duplicate decisions, corrections and atomic batch confirmation. A valid explicit launch account wins over remembered browser preferences. Preferences hydrate once per launch context so rerenders do not reset an account the user subsequently chose. Invalid/archived launch accounts fall back safely.

Review and parsed examples use the expense grid's presentation signs (positive purchase, negative refund) while persistence, source matching and exports keep the established money-flow signs. New persisted review originals additionally retain raw mapped CSV cells in existing JSON, without changing normalized source identity or requiring a migration. Historic batches lacking those cells label their normalized values honestly. Transfers and income stay excluded from spending.

Untouched valid purchases default to Me and Uncategorized. Person-first controls make category edits optional without dropping saved categories. Bulk person/category actions work across every review page and preserve every existing raw row draft; they skip divided purchases, invalid/duplicate/skip decisions, unavailable allocations and nonspending kinds with visible counts and eligibility explanations. Person-only assignment retains category/amount/notes. No background saving or draft persistence is added. Final confirmation and unknown-outcome recovery retain existing batch guarantees.

Result links scope Expenses to the saved batch and account with explicit unbounded dates, including historical imports. Expense/refund batches open the expense view. Mixed-kind, transfer-only and repeated batches open All transactions with excluded-spending labels so successful imports never hide their nonspending rows behind the default view.

## Simple daily navigation and optional tools

Home after sign-in, sheet creation, sheet switching, and legacy sheet links without an explicit section open Expenses. The complete route registry remains available for explicit Overview, Budgets, Import, settings/export, invitation and source links; financial queries and browser hashes survive authorized legacy-sheet selection. The three primary destinations are Expenses, Repayments and Settings. Existing dirty-draft, pending/unknown-save, remembered-sheet, permission-loss and navigation-loading protections remain.

Settings prioritizes accounts, the shared billing cycle and Expense people. Sharing identifies login access separately. Category administration and recurring default budgets live in the Optional tools disclosure alongside links to the existing Overview, Budgets and payment plans. Original spending-categories, spending-groups, default-budgets, budget-cycle, people-heading and sheet-setup anchors remain reachable; hash navigation opens containing disclosures. Export retains all datasets, notes and signed money-flow values. Detailed editing retains manual income, transfers and allocation/category history.

First-entry setup requires only an active account before manual entry or CSV import. Me and Uncategorized remain available without extra configuration. Optional links expose additional expense people and the current billing cycle; only owners can change the cycle. Category limits, planning, saved CSV formats and repayment tracking remain optional. No data is removed or migrated for navigation changes.

Expenses reads a compact authorized plan-attention aggregate: active plans, overdue active plans, and every plan with an unresolved matched-source revision/deletion, including fulfilled plans. Counts are independent of the displayed expense period, filters and pagination. A visible link opens the existing payment-plan controls; source-review records never hide solely because their plan is fulfilled or in history. Budget/plan calculations and mutations remain unchanged.
