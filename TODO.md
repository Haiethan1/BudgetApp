# TODO

Issues captured on October 9, 2026. This is a backlog for later work. The design questions below are still open.

## Sheet navigation and URLs

- [ ] Reduce the emphasis on sheets in the navigation. Most people will keep adding to the same sheet and only occasionally switch to another person's sheet. Keep support for multiple unique sheets, but make switching a secondary action.
- [ ] Reconsider exposing the sheet ID in the URL. Determine whether it is needed in the endpoint and whether the usual single-sheet workflow can use a simpler URL. Preserve access to multiple sheets when needed.

## Amount owed and repayment tracking

- [ ] Add an amount-owed page or subsection, with a view based on attribution buckets.
- [ ] Separate outstanding amounts from amounts already paid off.
- [ ] Track repayments across months. Prefer all-time history; consider a rolling window of at least 365 days if appropriate. Decide the history scope before implementation.
- [ ] Let users mark an expense as paid back and record the repayment date.
- [ ] Let users add comments to each expense, whether it is paid or unpaid.
- [ ] Save repayment status, repayment date, and comments per transaction. Determine whether this needs a transaction identifier or a related record with a foreign key to the transaction.

## Import defaults and saved source profiles

- [ ] Automatically select the last-used saved source profile and financial account when importing. Selecting the first available option is an acceptable fallback if remembering the last-used values is much harder to implement.
- [ ] When a saved source profile is selected, lock its source configuration fields until the user explicitly clicks an Edit button.
- [ ] Hide or collapse the locked source configuration fields so they do not take up unnecessary space. When visible but locked, show them as disabled.
- [x] Limit parsed CSV preview pages to at most 10 rows. Both parsed and invalid row previews now use 10-row pages.

## Review dialogs

- [x] In the "Review source row {x}" dialog, block scrolling on the page behind the dialog. Allow scrolling inside the dialog when its content needs it.
- [x] Allow clicking outside a dialog to close it, including other dialogs throughout the app. Preserve the existing prompt to save changes before leaving when there are unsaved edits.
- [ ] Reconsider the required checkbox labeled "I reviewed this kind, including whether this is a card payment or income." Understand why it exists and remove the repeated confirmation requirement from each row review. Highlight Kind as an important field to check instead.

## Bulk import review

- [ ] Make the key review fields editable directly in the existing row list: Kind, row decision, category, and attribution.
- [ ] Keep the full review dialog for other fields and detailed edits. Users should only need to open it when they want those controls.

## Custom monthly budget cycles

- [ ] Let users configure a sheet's recurring monthly start and end dates to match their credit card statement cycle or preferred budgeting timeframe, instead of always using calendar months.
- [ ] Carry the chosen cycle forward each month. For example, October 8 through November 7 should be followed by November 8 through December 7, with both endpoints included.
- [ ] Decide how to handle cycle dates near the end of the month, including February, leap years, and months without a 31st. Consider restricting selectable days or falling back to the month's last day. Research common practice before choosing a rule, and keep consecutive cycles free of gaps or overlapping dates.

## Additional issues

Add new issues here as they come up.
