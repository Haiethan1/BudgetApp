# Budget periods API

Sheet reads include cycleStartDay, cycleVersion and cycleHistory with baselineDay and ordered revisions. A revision contains transitionFrom, recurringFrom and startDay. Read-only sheet membership rules apply. New sheets default to day 1; existing configured days survive migration 0012.

Budget and spending reads retain the `month` parameter name for compatibility. Canonical values are exact period starts such as `2026-10-20`. Legacy `2026-10` reads select the first period starting in October. A month entirely covered by a long transition selects that containing transition. Responses return canonical `month` and cycle `{from,to,startDay,version}`. Use both inclusive date bounds for ledger queries. Exact period keys distinguish two starts within one month.

Owner-only `POST /api/sheets/:sheetId/settings` accepts JSON:

```json
{"kind":"budgetCycle","startDay":20,"effectiveDate":"2026-10-20","transition":"short","version":1,"preview":true}
```

The preview includes original, transition, next, currentBefore/currentAfter bounds, future override mappings and previewToken. Each mapping has category, oldPeriod, newPeriod, limit, effectiveLimit, inheritsDefault and version. Preview never changes records. Effective date is the first new recurring start and must match the clamped day and be today or later using the UTC calendar date. Short transitions retain the period containing the prior date; long transitions retain the preceding period. Completed periods and scheduled transitions cannot be replaced.

Save the same controls with `preview:false` and the returned previewToken. Access, version, token, date rules, override mapping and the append-only revision save are atomic. A changed cycle or affected budget/default returns 409 and requires a fresh preview or explicit configuration reload. Validation errors return 400, nonowners 403 and inaccessible sheets 404. Same-origin and authenticated-session checks remain in force.

The transition keeps its full limit. Future overrides move one-to-one in successor order, without changing amounts, flags or versions. Preview discloses each old/new attachment, including explicit zero and no limit. Out-of-range mappings reject the entire save. Transactions and completed periods stay unchanged. Recurring defaults resolve by their effective exact period start. Changes begin in the actual current UTC period; completed limits stay unchanged.

Budget writes should include cycleVersion, the canonical exact period start and the existing override version. A stale exact start or cycle revision returns 409. Legacy month writes are accepted only when exactly one period starts in that month. Missing-start and multiple-start month writes return 409. After any schedule revision, all period writes require cycleVersion. Callers needing a later same-month period must use its exact start.

When a changed monthly anchor clamps to an existing boundary, the shorter-period choice derives an aligned boundary instead. The preceding period remains completely unchanged, even when already completed. The revision starts at the effective date itself, with transitionFrom equal to recurringFrom. The first recurring period retains its exact-start override; subsequent overrides map to corresponding successor months. Preview labels the unchanged preceding period, lists its retained limits, and includes the effective-start override in the attachment mapping. An aligned change to the same configured day is rejected as a no-op. Explicit longer transitions remain intentional extensions.

Default budget mutations use the budgets endpoint. saveDefault/removeDefault require categoryId, latest default version, cycleVersion, effectiveFrom equal to the actual current UTC period start, and currentVersion equal to that period's override revision (zero when absent). replaceCurrent defaults false. It explicitly returns the current override to inheritance; future explicit overrides never change. Reads include effectiveFrom/currentVersion/currentSource/currentLimit for this disclosure and periodDefaultLimit for the selected period. defaultLimit/defaultVersion describe the latest default.

A save with makeDefault additionally requires defaultVersion and the same current-period guards. Past/future selected periods receive an explicit amount separately, while the default starts at actual current. An explicit current override remains unchanged unless replaceCurrent is selected. All selected/current/default revisions and cycle checks run in one immediate transaction. Any conflict returns 409 with no partial writes. A UTC period rollover also requires reload. remove creates an explicit no-limit period override; useDefault deliberately restores inheritance. Zero remains a real limit.

Migration 0013 stores every legacy default, including null removal revisions, as a baseline effective from 0001-01-01. budget_default_changes retains append-only revisions keyed by category/version. The effective default is the latest effective_from no later than the exact resolved period start, with highest version winning for repeated changes during one period. The existing cycle resolver remains the period authority. Changing a future cycle leaves these current/historical anchors intact.
