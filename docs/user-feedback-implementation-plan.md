# User-feedback implementation plan

GitHub progress tracker: [#41](https://github.com/Haiethan1/BudgetApp/issues/41). Keep completion status there and sequencing detail here.

Prepared October 13, 2026; baseline corrected October 14 after updating main. Covers [issues #29–40](https://github.com/Haiethan1/BudgetApp/issues?q=is%3Aissue%20number%3A29..40). All twelve issues were open with no comments at the original review. This is an implementation sequence, not a claim that the feedback has shipped.

## Product direction

Help users configure a sheet, bring in transactions, review them without repetitive saves, and understand the results. Build period-aware budgets before adding upcoming-payment planning. Keep spending, debts, repayments, and planned contributions distinct so each amount has an explainable meaning.

The individual issues own their acceptance criteria. This plan owns sequencing, shared responsibilities, and cross-feature validation. The original [implementation plan](implementation-plan.md) remains the behavior reference for shipped features. Update it as these approved extensions land, rather than treating its original deferred list as a prohibition on this work. Material UI changes also update [the specification](website-spec.md) and [visual reference](website-reference.html) in the same change.

## Current implementation and discovery gate

Baseline: main at cea119e, including merged PR #28. The original inspection used an outdated local checkout at d9e755b; its missing-feature conclusions are superseded below.

- Settings, manual entry, import, Overview, monthly budgets, and Amount owed are implemented.
- Budgets use YYYY-MM start-month labels with a configurable sheet-wide cycle in src/sheets/cycle.ts. Changing the start day currently recomputes historical grouping. #32 adds effective dates and stable history to this existing model.
- Recurring defaults and explicit monthly overrides already exist. Defaults currently affect past periods that inherit them. #31 changes effective-date behavior while preserving overrides; it does not introduce defaults from scratch.
- Import setup and review share src/components/import-screen.tsx. Inline drafts already survive pagination, but require explicit row saves. Full editors, corrections, and bulk allocations have separate paths. #35 unifies pending edits and final submission while retaining existing duplicate and conflict protection. Valid untouched rows already need no individual kind acknowledgment.
- #33 separates selectable reusable formats from durable internal identities. Starting review does not save a reusable format. Canonical interpretation settings within each sheet/account retain duplicate matching against immutable historical batch mappings; display names do not change source identity. #34 extends the explanations and uploaded-file examples within this flow.
- Amount owed uses src/components/owed-screen.tsx and src/repayments/service.ts. Explicitly tracked groups contribute expense splits; repayment date/comment metadata lives on transactions and settles the whole expense. #38 extends this with standalone debts, grouped sources, explicit direction, and partial repayments. Preserve existing tracked selections and paid records during migration.
- Before implementation, recheck branch, issue status, current code, and migrations. Discovery can change this baseline without changing the approved user behavior.

## Recommended completion order

| Step | Issues | Deliverable | Why here |
| --- | --- | --- | --- |
| 1 | [#30](https://github.com/Haiethan1/BudgetApp/issues/30) | Consistent names and explanations | Establish wording used by every later screen |
| 2 | [#33](https://github.com/Haiethan1/BudgetApp/issues/33), [#34](https://github.com/Haiethan1/BudgetApp/issues/34) | One understandable CSV setup flow | Actions, examples, and errors change the same screen |
| 3 | [#36](https://github.com/Haiethan1/BudgetApp/issues/36) | Clear expense division in manual entry and import | Settle split interaction before changing import draft ownership |
| 4 | [#35](https://github.com/Haiethan1/BudgetApp/issues/35) | Import-wide in-memory drafts and final bulk submission | Preserve the new split interaction while removing per-row saves |
| 5 | [#32](https://github.com/Haiethan1/BudgetApp/issues/32) | Effective-dated cycle changes and stable historical periods | Extend existing cycles before revising defaults and adding payment plans |
| 6 | [#31](https://github.com/Haiethan1/BudgetApp/issues/31) | Effective-dated defaults preserving existing overrides | Extend existing recurring limits against stable periods |
| 7 | [#29](https://github.com/Haiethan1/BudgetApp/issues/29) | Setup checklist and first-transaction guidance | Link to real, settled cycle, default-budget, and import controls |
| 8 | [#38](https://github.com/Haiethan1/BudgetApp/issues/38) | Custom debts, grouping, and partial repayment records | Extend existing whole-expense settlement with authoritative remaining totals |
| 9 | [#37](https://github.com/Haiethan1/BudgetApp/issues/37) | Outstanding and Paid back views | Build lists and filters on the repayment model |
| 10 | [#40](https://github.com/Haiethan1/BudgetApp/issues/40) | Contributions toward upcoming payments | Use period boundaries and budget rules already in place |
| 11 | [#39](https://github.com/Haiethan1/BudgetApp/issues/39) | Complete manual spreadsheet export | Export stable periods, budgets, debts, and repayment history |

This is the default queue for one implementer. A row grouping issues does not require a single large PR. #33 and #34 should be designed and reviewed together, with coherent commits and no duplicate screen rewrite.

## Dependencies versus scheduling preferences

- #30 is a wording prerequisite for the final presentation of every later issue. Do not rename database tables solely to match labels.
- #33 and #34 are one coordinated screen change. #35 can be developed independently of their internals, but schedule it afterward because both edit import-screen.tsx.
- #36 before #35 is a shared-editor scheduling preference, not a backend dependency. #35 can start once split draft fields and callbacks are agreed.
- #32 before #31 coordinates changes to the existing cycle and default models around historical preservation. #40 requires the settled period, budget-default, and override rules.
- #29 can start earlier with tasks for implemented features. Complete it only when cycle, default-budget, and CSV links and completion checks are real. It does not wait for custom debts, export, or upcoming-payment planning.
- #38 before full completion of #37 avoids redesigning direction and partial-payment totals twice. The section layout, pagination, and history controls in #37 can ship sooner using the existing whole-expense repayment service. Complete direction and partial-payment integration after #38.
- #39 can deliver transaction and split export earlier. Keep it open until all datasets available by the end of this program are supported, including budgets, debts, and repayments. #40 is scheduled before final export QA because it changes budget presentation, not because its plan records are an additional required export dataset.
- After #30, the import/editor work and period/budget work can progress independently. Repayment work is also independent of custom cycles. Keep edits to shared screens, migrations, and behavior documents coordinated rather than assigning two simultaneous writers to the same files.

## Shared code and ownership

| Area | Issues touching it | Implementation boundary |
| --- | --- | --- |
| Settings, shell, shared fields | #30, #32, #31, #29 | Shared names, required-field treatment, real setup links, and one source of setup completion |
| import-screen.tsx, import-review-row.tsx, source-configuration.tsx | #30, #33, #34, #35, #36 | Extend existing setup and inline drafts; review owns drafts by stable row ID; final action owns submission |
| import-row-editor.tsx and transaction-editor.tsx | #30, #36, #35 | Reuse split controls and exact-money validation; keep save behavior appropriate to manual entry versus import |
| imports/review.ts, input, HTTP routes, import schema | #33, #35 | Stable import identity, server validation, stale detection, and atomic confirmation |
| sheets/cycle.ts, budget schema/service, ledger spending, Overview, navigation | #32, #31, #40, #39 | Extend current cycle and default rules with history; separate actuals and planning |
| repayments/service.ts, owed-screen.tsx, transaction repayment metadata | #38, #37, #39 | Preserve existing records; one calculation for remaining debt, direction, completion, and grouped-source totals |
| Behavior plan, website spec, reference | All UI and rule changes | Update with each feature; avoid a final documentation sweep that leaves interim behavior unspecified |

Extract shared controls only where manual and import editors need the same behavior. The manual transaction editor keeps its explicit Save transaction action. #35 changes import review only.

## Work packages and exit checks

### Names and CSV setup: #30, #33, #34

Use Transaction accounts, Spending categories, Spending groups, and CSV import formats consistently. Show source headings and real samples beside choices, with interpreted transaction examples. Mark requirements accessibly and explain blockers near controls.

Automatically check a selected saved format against the current file. Continue to review performs outstanding checks. Reject stale async results when the file, account, or format changes. Remembering a reusable format is optional; changing an import-specific configuration must not silently update the saved format.

Decide how an unsaved format retains stable duplicate identity across later imports. Existing batches and transaction-source links must remain usable. Do not mint unrelated identities on every import or merge incompatible formats just to hide the profile concept.

Exit: first-time and saved-format imports reach review without Save then Validate clicks. Missing columns, ambiguous dates, incompatible saved formats, and profile conflicts stay actionable. Repeat import still adds no duplicates, including after ledger edits or deletion.

### Split editing and import drafts: #36, #35

Make Divide this expense show two understandable parts and the remaining amount. Both editors use the same rules for totals, signs, refunds, categories, and spending groups.

Extend the existing import-level inline drafts to full editors, corrections, and splits, keyed by stable row ID rather than page position. Preserve incomplete fields when an editor closes. Derive readiness and counts across the whole draft. Corrections still require server normalization and duplicate review before money is committed. Reconcile bulk allocations with pending drafts explicitly; do not silently overwrite them or restore mandatory per-row saves.

Submit accumulated review edits through the final import action with authorization, version checks, current duplicate checks, and atomic transaction creation. Do not implement this as an unprotected sequence of per-row PATCH calls followed by confirmation.

Refreshing or reopening discards only pending client edits and reloads the persisted review. No local-storage persistence or automatic server draft saving. Explain the lifetime and guard navigation when permitted. Preserve drafts on failed submissions and conflicts; uncertain outcomes require checking batch status before retrying.

Exit: edit rows on multiple pages, including incomplete splits and corrected invalid rows; return to each without losing edits. Refresh restores the saved review. Network failure, stale review, and retry never produce partial or duplicate transactions.

### Periods and defaults: #32, #31

Extend the existing configurable start-day model with effective dates, stable historical boundaries, and transition rules. Issue #32 migrates YYYY-MM keys to exact clamped start dates and retains ordered cycle revisions. Future overrides move by successor position with their old/new attachments previewed explicitly. Do not assume existing periods are calendar months. Existing limits, inheritance flags, explicit no-limit states, and versions survive. Stored transaction dates do not move.

Use one sheet-wide cycle across Overview, Budgets, and transaction filters. Define which current-period boundaries can change and preserve completed periods. Transition previews show short or long periods without gaps or overlaps.

Version existing recurring defaults by effective period. Preserve the distinction already present between inheritance, explicit zero, and explicit no limit. Baseline each existing default so migration does not alter the reports users currently see. Preserve manual current and future overrides. Replacing the current override requires an explicit choice. Decide how defaults and overrides map into a transition period; do not silently prorate.

Exit: historical reports agree before and after migration. Leap days, short months, transition dates, and concurrent changes behave consistently across all screens. A current default change preserves earlier budgets and manual future overrides.

### Setup completion: #29

Derive sheet progress from actual configuration, including another member's changes. Do not treat protected fallback entries as unfinished solely because they exist. Manual-entry users do not require a CSV format.

Connect checklist tasks to the finished settings and import controls. Define session dismissal so ordinary navigation does not bring the reminder back. Keep Import CSV and Add transaction available throughout setup.

Exit: fresh sheets, configured shared sheets, manual-only users, dismissed reminders, and returning sessions each receive accurate guidance.

### Debts and their presentation: #38, #37

Extend the existing whole-expense repayment implementation with debtor and recipient references, standalone and grouped obligations, repayment records, opening paid amounts, remaining totals, and completion dates. People or groups need not have logins. Define how tracked expense splits and existing repayment dates migrate without turning every allocation into a debt or losing recorded payments and comments. Existing records may lack an explicit recipient; require clarification rather than guessing one from the current viewer.

Explicitly create debts; spending-group allocations alone do not imply money owed. Grouped sources contribute once. Later source changes require review rather than silently changing the agreement. Define repayment corrections and overpayment handling before implementation.

Build Outstanding across all dates, 10 per page, with totals across all matches. Paid back initially shows 10 entries completed in the past three months. History requests have at most 100 results with pagination or narrower ranges. Show direction in plain text.

Exit: partial repayments stay outstanding, completed entries move to history, grouped totals are counted once, changed/deleted sources are reviewable, and debts or repayments do not change spending totals.

### Upcoming-payment planning: #40

Plan future payments only. Set expected amount, due date, category, and recurrence, then calculate exact Planned contribution amounts across remaining budget periods. Late starts visibly change the required contribution.

Before coding, document how contributions affect category limits, how matching a payment prevents double budget charging, and how amount differences, missed payments, cancellations, and cycle changes are handled. These calculation choices remain implementation decisions to resolve, not already specified formulas.

Keep actual spending by payment date intact and distinguish it from the planning view. Plans do not prove savings or create transactions automatically. Matching is explicit and cannot match the same payment twice.

Exit: the six-period insurance example, annual-fee rounding, late starts, transition cycles, changed plans, and actual-payment matching all reconcile without changing historical transaction dates or counting the expense twice in the budget.

### Manual export: #39

Prefer a workbook with separate transaction-summary, split-detail, budget, debt, and repayment tabs. Define date-range semantics per dataset and retain stable relationships. Separate transaction totals from split amounts.

Use authorized sheet reads and a consistent data snapshot for a workbook. Export all matching records independently of page limits. Write user-entered strings as text. Include currency, period dates, scope, and generation time.

Exit: full and date-filtered workbooks reconcile to app totals; partial repayments, grouped debts, explicit budget overrides, and archived labels remain understandable. No rows disappear at UI pagination boundaries. Open the actual workbook and verify its contents and layout. Direct Google Sheets integration and automated transfer remain deferred.

## Delivery and completion rules

Each issue closes only when its own acceptance criteria and relevant exit checks pass. Attach implementation PRs and actual validation evidence to the work issues. Keep the umbrella checklist current without duplicating live issue status in this document.

Use the repository's lint, typecheck, focused tests, and build checks appropriate to the change. For schema changes, verify migration on populated data and restore compatibility. New debt and plan records must be included in backup/restore coverage. Finish with a populated restore exercise and combined import, budget, repayment, planning, and export checks.

UI evidence uses actual app screenshots at 1440px and 390px, overflow checks at 320px, keyboard interaction, and relevant loading, empty, error, permission, and conflict states. The HTML reference does not prove behavior.

Keep scope limited to the twelve issues. This program does not add bank synchronization, account balances, verified savings, multiple cycles per sheet, persistent import drafts, retroactive spreading of recorded payments, or automatic Google Sheets transfer.

Issue #31 extends existing defaults with append-only effective-period history, baselined in migration0013. Default changes begin at the actual current UTC period; earlier reports and explicit current/future overrides remain. The optional explicit current replacement, current override revision, default revision and cycle revision are checked atomically. Monthly makeDefault while viewing past/future changes that selected explicit amount separately. Zero, explicit no limit and inheritance remain distinct.
