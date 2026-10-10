# TODO

Issues captured on October 9, 2026. Work is now underway. Completed items are checked and crossed out; remaining design questions are recorded below.

## Sheet navigation and URLs

- [x] ~~Reduce the emphasis on sheets in the navigation. Most people will keep adding to the same sheet and only occasionally switch to another person's sheet. Keep support for multiple unique sheets, but make switching a secondary action.~~ Switch sheet and Create sheet now use a secondary dialog from the navigation footer.
- [x] ~~Reconsider exposing the sheet ID in the URL. Determine whether it is needed in the endpoint and whether the usual single-sheet workflow can use a simpler URL. Preserve access to multiple sheets when needed.~~ Regular page URLs use the authorized remembered selection. APIs retain explicit IDs; older sheet links still select their intended sheet. Header, data, and editors stay on the same sheet through navigation and cross-tab selection changes.

## Amount owed and repayment tracking

- [x] ~~Add an amount-owed page or subsection, with a view based on attribution buckets.~~ Amount owed groups expenses by explicitly selected tracked buckets; no bucket counts as owed by default. Archived buckets retain their history.
- [x] ~~Separate outstanding amounts from amounts already paid off.~~ Separate tracked totals and status filters show outstanding and paid expenses with exact split contributions.
- [x] ~~Track repayments across months. Prefer all-time history; consider a rolling window of at least 365 days if appropriate. Decide the history scope before implementation.~~ All-time history is independent of budget months and retains prior repayment dates and comments.
- [x] ~~Let users mark an expense as paid back and record the repayment date.~~ Paid back records a calendar date and settles the whole expense across its splits. Reopening clears the date; partial repayments remain deferred.
- [x] ~~Let users add comments to each expense, whether it is paid or unpaid.~~ Each expense has an editable comment in either state; All expenses also exposes untracked expenses.
- [x] ~~Save repayment status, repayment date, and comments per transaction. Determine whether this needs a transaction identifier or a related record with a foreign key to the transaction.~~ Metadata lives on the existing transaction ID. A nullable repayment date determines status; repayment and ledger edits share optimistic versions. Spending calculations remain unchanged.

## Import defaults and saved source profiles

- [x] ~~Automatically select the last-used saved source profile and financial account when importing. Selecting the first available option is an acceptable fallback if remembering the last-used values is much harder to implement.~~ Preferences now persist per user and sheet in this browser, with active account and same-account profile fallbacks.
- [x] ~~When a saved source profile is selected, lock its source configuration fields until the user explicitly clicks an Edit button.~~ Edit source explicitly unlocks the saved configuration.
- [x] ~~Hide or collapse the locked source configuration fields so they do not take up unnecessary space. When visible but locked, show them as disabled.~~ View source settings reveals disabled controls; selecting or saving a profile collapses them again.
- [x] ~~Limit parsed CSV preview pages to at most 10 rows.~~ Both parsed and invalid row previews now use 10-row pages.

## Review dialogs

- [x] ~~In the "Review source row {x}" dialog, block scrolling on the page behind the dialog. Allow scrolling inside the dialog when its content needs it.~~
- [x] ~~Allow clicking outside a dialog to close it, including other dialogs throughout the app. Preserve the existing prompt to save changes before leaving when there are unsaved edits.~~
- [x] ~~Reconsider the required checkbox labeled "I reviewed this kind, including whether this is a card payment or income." Understand why it exists and remove the repeated confirmation requirement from each row review. Highlight Kind as an important field to check instead.~~ Kind guidance replaces the checkbox. Saving a valid row confirms the chosen kind; corrected source rows still require review.

## Bulk import review

- [x] ~~Make the key review fields editable directly in the existing row list: Kind, row decision, category, and attribution.~~ Responsive row forms show these controls with an explicit Save row review action and at most 10 rows per page. Drafts survive paging and reloads, and concurrent changes require explicit resolution.
- [x] ~~Keep the full review dialog for other fields and detailed edits. Users should only need to open it when they want those controls.~~ Full review retains dates, payees, amounts, source corrections, duplicate details, and exact splits. Multi-split allocations stay protected; unsaved inline edits prompt before opening detailed review or leaving.

## Bulk import review — part 2

- [x] ~~Remove the requirement to review or click Save row review for every row before importing. Valid rows should import with their proposed values and default category/attribution unless the user chooses to change them. Reviewing and editing individual rows should be optional, so a CSV with 1,000 rows does not require 1,000 confirmations. Distinguish actual blocking errors or unresolved duplicate decisions from optional review; make the next step available without clicking through every valid row.~~ Valid rows and valid source corrections now import their proposals and protected allocation defaults without per-row confirmation. Invalid rows and unresolved duplicate decisions still block; optional unsaved edits must be saved or discarded. Atomic confirmation, stale previews, permissions, and retry identity remain enforced.
- [ ] Condense the review rows so more transactions and their key review fields fit on screen at once.
- [ ] Reconsider the 10-row limit for the review stage. Show all rows, or as many as practical without making the page excessively long, to reduce paging and the burden of reviewing every row. Keep this separate from the parsed CSV preview's 10-row limit.
- [ ] Add controls at the top of the review list, such as dropdowns and an Apply button, to apply a category or attribution to all rows in bulk instead of editing each row individually. Decide how these actions handle split transactions and rows that cannot use the chosen allocation before implementation.

## Custom monthly budget cycles

- [ ] Let users configure a sheet's recurring monthly start and end dates to match their credit card statement cycle or preferred budgeting timeframe, instead of always using calendar months.
- [ ] Carry the chosen cycle forward each month. For example, October 8 through November 7 should be followed by November 8 through December 7, with both endpoints included.
- [ ] Decide how to handle cycle dates near the end of the month, including February, leap years, and months without a 31st. Consider restricting selectable days or falling back to the month's last day. Research common practice before choosing a rule, and keep consecutive cycles free of gaps or overlapping dates.

## Additional issues

Add new issues here as they come up.
