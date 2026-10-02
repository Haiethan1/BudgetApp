# Homebooks MVP issue backlog

GitHub is the working tracker: [MVP implementation tracker #2](https://github.com/Haiethan1/BudgetApp/issues/2).
The approved planning artifacts are in [draft PR #1](https://github.com/Haiethan1/BudgetApp/pull/1). Merge that PR before landing implementation; work can start from `codex/mvp-planning-and-backlog` while it is under review.

Start with [#4 — Application scaffold](https://github.com/Haiethan1/BudgetApp/issues/4), while [#3 — Household inputs](https://github.com/Haiethan1/BudgetApp/issues/3) records the required CSV exports, currency, attribution labels, and deployment choice. Authentication and shared UI can proceed independently after scaffolding. Stages group reviewable outcomes; each issue lists its actual blockers.

Each work issue includes acceptance criteria, dependencies, and links to the implementation plan, website specification, visual reference, and agent instructions. UI handoffs require actual desktop and phone screenshots and relevant interaction states. See [AGENTS.md](../AGENTS.md) before implementation.

## Stage 0 — Foundation

| Issue | Work | Depends on |
| --- | --- | --- |
| [#3](https://github.com/Haiethan1/BudgetApp/issues/3) | Confirm household CSV profiles, currency, attribution, and deployment | Planning PR only |
| [#4](https://github.com/Haiethan1/BudgetApp/issues/4) | Scaffold Next.js, Drizzle SQLite, Docker, and development checks | Planning PR only |
| [#5](https://github.com/Haiethan1/BudgetApp/issues/5) | Implement authentication, first-admin setup, and controlled registration | [#4](https://github.com/Haiethan1/BudgetApp/issues/4) |
| [#6](https://github.com/Haiethan1/BudgetApp/issues/6) | Implement sheet creation, ownership, and server-side access checks | [#5](https://github.com/Haiethan1/BudgetApp/issues/5) |
| [#7](https://github.com/Haiethan1/BudgetApp/issues/7) | Implement validated SQLite snapshots and offline restore commands | [#6](https://github.com/Haiethan1/BudgetApp/issues/6) |
| [#8](https://github.com/Haiethan1/BudgetApp/issues/8) | Build shared design tokens, components, and responsive application shell | [#4](https://github.com/Haiethan1/BudgetApp/issues/4) |

## Stage 1 — Spending

| Issue | Work | Depends on |
| --- | --- | --- |
| [#9](https://github.com/Haiethan1/BudgetApp/issues/9) | Implement financial accounts, categories, and attribution settings | [#6](https://github.com/Haiethan1/BudgetApp/issues/6), [#8](https://github.com/Haiethan1/BudgetApp/issues/8) |
| [#10](https://github.com/Haiethan1/BudgetApp/issues/10) | Implement transaction and split rules with atomic writes and edit conflicts | [#9](https://github.com/Haiethan1/BudgetApp/issues/9) |
| [#11](https://github.com/Haiethan1/BudgetApp/issues/11) | Build transaction ledger, filters, and split entry drawer | [#10](https://github.com/Haiethan1/BudgetApp/issues/10), [#8](https://github.com/Haiethan1/BudgetApp/issues/8) |

## Stage 2 — CSV import

| Issue | Work | Depends on |
| --- | --- | --- |
| [#12](https://github.com/Haiethan1/BudgetApp/issues/12) | Implement CSV mapping, normalization, and validation previews | [#10](https://github.com/Haiethan1/BudgetApp/issues/10) |
| [#13](https://github.com/Haiethan1/BudgetApp/issues/13) | Implement import identity, duplicate review, and idempotent atomic commit | [#12](https://github.com/Haiethan1/BudgetApp/issues/12) |
| [#14](https://github.com/Haiethan1/BudgetApp/issues/14) | Build CSV import mapping, review, and result screens | [#13](https://github.com/Haiethan1/BudgetApp/issues/13), [#8](https://github.com/Haiethan1/BudgetApp/issues/8), [#3](https://github.com/Haiethan1/BudgetApp/issues/3) |

## Stage 3 — Budgets and Overview

| Issue | Work | Depends on |
| --- | --- | --- |
| [#15](https://github.com/Haiethan1/BudgetApp/issues/15) | Implement monthly category limits and Budgets screen | [#10](https://github.com/Haiethan1/BudgetApp/issues/10), [#8](https://github.com/Haiethan1/BudgetApp/issues/8) |
| [#16](https://github.com/Haiethan1/BudgetApp/issues/16) | Build Overview spending, category budgets, and family attribution | [#15](https://github.com/Haiethan1/BudgetApp/issues/15), [#11](https://github.com/Haiethan1/BudgetApp/issues/11) |

## Stage 4 — Sharing

| Issue | Work | Depends on |
| --- | --- | --- |
| [#17](https://github.com/Haiethan1/BudgetApp/issues/17) | Implement owner invitations, membership transitions, and revocation | [#6](https://github.com/Haiethan1/BudgetApp/issues/6) |
| [#18](https://github.com/Haiethan1/BudgetApp/issues/18) | Build invitations and People settings with no-sheet and revoked states | [#17](https://github.com/Haiethan1/BudgetApp/issues/17), [#8](https://github.com/Haiethan1/BudgetApp/issues/8), [#9](https://github.com/Haiethan1/BudgetApp/issues/9) |

## Stage 5 — Family release

| Issue | Work | Depends on |
| --- | --- | --- |
| [#19](https://github.com/Haiethan1/BudgetApp/issues/19) | Add backup scheduling, retention, export, and admin status | [#7](https://github.com/Haiethan1/BudgetApp/issues/7) |
| [#20](https://github.com/Haiethan1/BudgetApp/issues/20) | Verify money, permissions, concurrency, and responsive MVP flows | [#16](https://github.com/Haiethan1/BudgetApp/issues/16), [#14](https://github.com/Haiethan1/BudgetApp/issues/14), [#18](https://github.com/Haiethan1/BudgetApp/issues/18), [#19](https://github.com/Haiethan1/BudgetApp/issues/19), [#5](https://github.com/Haiethan1/BudgetApp/issues/5) |
| [#21](https://github.com/Haiethan1/BudgetApp/issues/21) | Document deployment and pass Docker persistence and fresh-volume restore | [#20](https://github.com/Haiethan1/BudgetApp/issues/20), [#3](https://github.com/Haiethan1/BudgetApp/issues/3) |

## Release and scope

Complete each issue's acceptance criteria and report validation before closing it. The family release requires [integration acceptance #20](https://github.com/Haiethan1/BudgetApp/issues/20) and [Docker persistence and fresh-volume restore #21](https://github.com/Haiethan1/BudgetApp/issues/21).

Bank sync, debt and settlement, balances and reconciliation, goals, rollover, per-bucket budgets, multiple currencies, ownership transfer, and browser restore remain deferred.

Issue bodies on GitHub are authoritative for ongoing status and refinements. [github-issues.json](github-issues.json) records the initial breakdown and published issue identities.

