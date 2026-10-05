# CSV import API

The import backend persists reviewed batches and confirms them atomically. The Import screen remains unavailable until its UI implementation. The household's effective date and complete export conventions remain unconfirmed, so each mapping explicitly selects those values.

All operations require a signed-in sheet owner or accepted member. Mutations also require the configured browser origin. Responses containing review data use `Cache-Control: no-store`.

## Endpoints

Paths below start with `/api/sheets/:sheetId`.

| Method and path | Input | Response |
| --- | --- | --- |
| `POST /imports/preview` | Multipart `file`, `accountId`, optional JSON `mapping` | Headers and samples without mapping; normalized rows with mapping. Neither writes records. |
| `POST /imports` | Multipart `file`, `accountId`, JSON `mapping`, optional `profileId` | A persisted review. A new profile name creates an account-scoped saved profile. |
| `GET /imports/profiles?accountId=…` | Account ID | Saved mappings with stable profile IDs and versions. |
| `POST /imports/profiles` | JSON `{ accountId, mapping, id?, version? }` | Created or updated profile. Updating an existing profile requires its current version. |
| `GET /imports/:batchId` | Batch ID | Current review or committed result, including status after a network failure. |
| `PATCH /imports/:batchId` | JSON `{ version, rowId, decision?, kindReviewed?, proposed?, correction? }` | Updated review and version. One row per request. |
| `POST /imports/:batchId/confirm` | JSON `{ version }` | `{ kind, review, changedRowIds, changedDecisions? }`. |
| `GET /transactions?batchId=…` | Same-sheet batch ID plus ordinary ledger filters | Only transactions added by that batch. Existing ledger pagination and filters still apply. |

Uploads retain the preview endpoint's 2 MiB and 5,000-row limits. JSON mutations reject bodies over 64 KiB while reading the request stream. Confirmation sends the version only; it never resubmits the file or every row.

`proposed` uses the manual ledger transaction input, including exact signed decimal amounts and splits. All splits must sum to the parent, share its sign, and reference active same-sheet labels. The account remains the batch's account. Sending a proposal acknowledges its kind; a separate `kindReviewed: true` acknowledges an unchanged proposal.

`decision` is `keep`, `skip`, `exclude`, or `pending`. Possible duplicates require a deliberate keep or skip. Invalid rows require a valid correction or explicit exclusion. `correction` supplies mapped source column names and values for an invalid row. Once valid source identity exists, further transaction edits change the proposal rather than the source identity.

## Review and result

A review contains `id`, `sheetId`, `accountId`, `profileId`, an immutable mapping snapshot, `state`, `version`, `rows`, `counts`, `ready`, `repeatedFile`, and `result`. State is `review` or `committed`.

Rows contain their source position, immutable original source or mapped invalid values, normalized source identity, proposal, validation errors, decision, and kind acknowledgment. `matching` contains `new`, `definite`, or `possible`, a reason, occurrence counts, and inspectable existing transaction summaries. Deleted transactions remain visible as duplicate candidates. Summaries include the edited transaction and its original imported fields separately.

Each row returns at most 20 candidate summaries. `candidateCount` reports the full count; `occurrence` and `existingOccurrences` report the incoming occurrence position and existing tuple count. The UI must disclose when it shows only the first 20 matches. Identical rows without source IDs remain separate purchases. Overlapping files and manual matches require decisions.

A committed result contains `added`, `skipped`, `excluded`, exact added `transactionIds`, `repeatedFile`, and `viewBatchId`. The latter identifies the batch for the ledger link. A repeated file adds zero and points to the original committed batch.

## Conflicts and retries

Confirmation returns `kind: "committed"` with HTTP 200. A successful retry returns the saved result even if its submitted version precedes the commit. Different reviews of the same file and mapping also add no transactions after the first commit.

A changed matching or organization snapshot returns `kind: "stale"` with HTTP 409, an updated review, and `changedRowIds`. Changed possible-duplicate decisions return to `pending`; `changedDecisions` records their previous choice. Proposals remain intact. Row edits and corrections that reveal a new possible match also require another explicit decision. A mismatched review version returns HTTP 409 with a reload message.

The server rechecks sheet access, active references, matching, and review version under the same immediate SQLite transaction as ledger writes, immutable source links, row links, and the committed outcome. A failure rolls back all those writes. After an uncertain network response, `GET /imports/:batchId` determines whether the batch committed before another confirmation is sent.

The database stores selected normalized identity and review fields, not the uploaded CSV. Unmapped card numbers and bank categories are not retained. Mapping snapshots remain unchanged when saved profile mappings change. Committed identities and outcomes survive snapshots and restore.
