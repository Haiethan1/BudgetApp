# Verify a family release

Use this procedure against the release candidate before using household data. Follow the [implementation plan](implementation-plan.md) for money and access rules and the [website specification](website-spec.md) for UI behavior. Run the checks in an isolated instance with synthetic accounts and statements.

Record the candidate commit, commands, expected and actual results, browser widths, and evidence locations. A procedure is not a passing test result. Keep screenshots, database files, credentials, and detailed validation records outside the public repository.

## Run the automated checks

Use Node.js 24 and the pinned pnpm version from `package.json`. Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod --audit-level high
```

Investigate each failure before proceeding. Review lower-severity audit findings separately and record any accepted limitation with its dependency and advisory. Repeat affected checks after repairs. Retain the exact build that passes for browser and Docker verification.

## Create an isolated family fixture

Complete first-admin setup and register separate member and unrelated-user accounts. Create a USD sheet named Family and another isolated sheet. In Family, add Checking and Visa accounts, the four categories below, and Ethan and Parents attribution buckets. Keep the protected Uncategorized category and Unassigned bucket.

Enter the eight transactions from the [reference fixture](website-spec.md#reference-fixture) through the actual transaction editor, including its split controls. Use October 2026 dates. Set the monthly category limits through Budgets.

Compare Overview, Budgets, ledger records, and persisted splits with these exact values:

| Value | Expected October result |
| --- | --- |
| Net spending | $278.00 |
| Groceries spending | $80.00 |
| Utilities spending | $120.00 |
| Dining spending | $24.50 |
| Transport spending | $35.00 |
| Uncategorized spending | $18.50 |
| Ethan attribution | $169.50 |
| Parents attribution | $90.00 |
| Unassigned attribution | $18.50 |
| Groceries limit and remaining | $150.00 and $70.00 |
| Utilities limit and overspending | $100.00 and $20.00 |
| Dining limit and remaining | $100.00 and $75.50 |
| Transport limit and remaining | $60.00 and $25.00 |
| Total limits | $410.00 |
| Spending in budgeted categories | $259.50 |
| Remaining in budgeted categories | $150.50 |

Keep income and the card-payment transfer excluded from spending and attribution. Do not use fixture values as production defaults.

In separate test records, check a refund in the following month, a zero limit, a removed limit, and a month with no limits. Confirm that the refund changes only its effective month and that a zero limit remains a real budget. Reject zero amounts, mixed-sign splits, incorrect split sums, excess precision, and references to another sheet. Verify that rejected writes leave no partial records.

## Exercise import confirmation

Use the [synthetic Capital One file](fixtures/capital-one-candidate.csv) and the agreed [household mapping](household-inputs.md#csv-candidate-and-synthetic-fixture). Choose the account, date format, debit and credit columns, decimal separator, and blank unused cells explicitly. Review every proposed kind, including the payment transfer.

Verify these outcomes through the actual import pages and persisted records:

- Mapping shows the original sample and normalized values. Invalid rows require correction or explicit exclusion.
- Two identical purchases in a new file remain two purchases. An ambiguous match in an overlapping file requires an explicit keep or skip decision.
- Confirmation writes transactions, splits, source links, and the batch result together. A forced failure leaves none of those partial writes.
- Repeating confirmation returns the saved outcome and adds nothing. Reimporting the same file adds nothing after editing or deleting its imported transaction.
- A stale review returns for review with an actionable explanation. It does not silently change the approved decision.
- A lost confirmation response offers a status check before retry. A successful status check reports the committed result without another import.
- Removing sheet membership after preview blocks confirmation on the next request.

Compare import identity and occurrence counts in the database with the visible result. Do not retain the original upload or unmapped card identifiers in persisted reviews.

## Verify sharing and concurrent edits

Use independent signed-in browser sessions for the owner, invitee, and unrelated user. Check direct server requests as well as visible controls.

1. Search by display name as the owner and distinguish matching names by username.
2. Invite the member and confirm that pending invitation access reveals no financial records.
3. Accept the invitation and repeat acceptance. Confirm that exactly one membership exists and the member can edit transactions and budgets.
4. Confirm that the member cannot search users for invitations, invite others, rename or delete the sheet, or remove members.
5. Revoke a pending invitation and confirm that its recipient cannot accept it.
6. Remove an accepted member and confirm that their next read, write, and import confirmation fail. Check the remembered selection and any open editor for cleared financial access.
7. Invite the former member again. Verify acceptance and the member's leave action. Confirm that the owner cannot leave while retaining the sheet.
8. Submit two edits using the same transaction revision, then the same budget revision. Confirm that the stale edit returns a visible conflict and preserves unsaved input until the user chooses to reload.

Reject unrelated-user sheet IDs and cross-sheet account, category, bucket, transaction, and import references. Verify that instance administration alone grants no sheet access. Check global invitations for a user without a sheet.

## Check the actual UI at each width

Capture actual app screenshots at 1440px and 390px. Check 320px for page overflow. Cover sign-in, the sheet shell, Overview, Transactions, Budgets, Import, Settings, Share, incoming invitations, and administrator backup status. Include phone transaction entry with splits and phone import review with duplicate decisions.

Exercise each applicable state rather than filling empty screens with fixture defaults:

- First-use and empty-month views, empty filtered results, no limits, and no invitations.
- Initial loading, failed loads with Retry, field validation, and pending saves that prevent duplicate submission.
- Permission failures, expired sessions, removed membership, and transaction and budget conflicts.
- Invalid import rows, unresolved duplicates, stale review, and uncertain confirmation outcomes.
- Backup status with no success, current failure, recovery, unavailable or stale status, and non-admin access.

Check long payees, large signed amounts, multiple splits, refunds, overspending, zero limits, and missing limits. Keep month context consistent between Overview and Budgets. Confirm that changing sheets closes editors and shows the correct role and currency.

Use the keyboard to open, traverse, and dismiss dialogs. Check focus containment, focus return, dirty-dismissal confirmation, and pending-action guards. Check visible focus, labels, contrast, reduced motion, and phone touch targets against the website specification. Reference screenshots demonstrate appearance only.

## Verify persistence and recovery

Follow the [snapshot and offline restore commands](../README.md#snapshots-and-offline-restore) and the [off-host backup runbook](backup-runbook.md). Run the existing isolated Docker procedures from the repository root:

```sh
pnpm docker:drill
pnpm docker:restore-drill
```

The recovery drill builds the final image and creates a populated family fixture through the real APIs. It verifies known transactions, splits, budgets, users, accepted membership, pending and revoked invitations, import identity after edits and deletion, exact totals, and restored session invalidation. It checks corrupt and incompatible candidates against the prior database bytes and verifies successful offline preservation and sidecar removal.

Record the immutable image ID printed by the drill. To repeat either drill independently against that image, set `HOMEBOOKS_DRILL_IMAGE` to the recorded ID. The default builds current source. Keep test-generated image tags for inspection as needed. The scripts remove only their generated Compose projects and volumes.

Verify restart persistence and daily startup catch-up. Restore a populated daily snapshot into fresh volumes and compare exact money values and identity records. Require fresh sign-in, verify restored member access, and repeat the original import with zero additions. Confirm that a corrupt or incompatible candidate leaves the current database unchanged and that a successful restore preserves the previous database without stale WAL files.

Verify a full encrypted off-host export, download, validation, and recovery with the chosen operator and destination. Record the tested release, origin, secret recovery method, volume mappings, and archive location in protected operator records.

## Resolve production inputs before household use

Confirm the production host, private-network browser origin, HTTPS or private HTTP configuration, persistent storage, off-host destination, and recovery operator in [household inputs](household-inputs.md#remaining-household-and-release-inputs). Follow the [deployment and recovery guide](deployment-guide.md) with those actual settings. Test registration closure, password recovery, upgrades, and restore on that host.

Report code and isolated-test results separately from production readiness. Leave any untested production criterion open until the operator completes it.
