# Homebooks website specification

This is the visual and interaction contract for the implemented app described in the [implementation plan](implementation-plan.md), including the improvements merged in PR #28. The [user-feedback implementation plan](user-feedback-implementation-plan.md) describes upcoming changes; update this specification as those changes land.

The [visual reference](website-reference.html) shows representative desktop and phone layouts using fixture data. It is a design artifact, not the app. This document defines every MVP screen, including states that the reference does not illustrate. The [system diagram](system-design.excalidraw) defines system relationships, not page layout.

## Design direction

Homebooks looks like a clear household ledger on warm paper. Light surfaces, fine borders, dark text, and one dark green accent establish the hierarchy. Most of the screen is useful information. Forms and tables have enough space for reading, editing, and touch input.

The visual identity uses the word Homebooks without a separate illustrated logo. Headings use the same sans-serif family as the body. There are no gradients, glass effects, decorative illustrations, large promotional headings, or decorative dashboard charts. The MVP has a light theme.

## Document ownership

| Reference | Defines |
| --- | --- |
| [Implementation plan](implementation-plan.md) | Product scope, permissions, money rules, storage, and release behavior |
| This specification | Layout, tokens, components, presentation, interaction states, and responsive behavior |
| [Visual reference](website-reference.html) | Representative proportions, density, placement, and component appearance |

The implementation plan determines amounts and access rules. The specification determines how the website presents them. When either document leaves a small visual choice open, reuse the nearest component in the visual reference. Record material design changes in this document and update the reference in the same change. Do not add product features to resolve a visual gap.

## Visual tokens

Implement these as shared CSS custom properties or equivalent theme tokens. Pages use the shared tokens instead of introducing local colors and spacing scales.

| Token | Value | Use |
| --- | --- | --- |
| `--color-canvas` | `#F7F7F2` | App background |
| `--color-surface` | `#FFFFFF` | Panels, fields, dialogs |
| `--color-surface-muted` | `#F0F1EA` | Table headers, secondary sections |
| `--color-text` | `#202A24` | Body text, amounts, headings |
| `--color-text-muted` | `#58645B` | Supporting copy and field hints |
| `--color-border` | `#D8DED5` | Decorative panel and row separators |
| `--color-control-border` | `#788578` | Input and interactive outline boundaries |
| `--color-accent` | `#214E3B` | Primary buttons, active navigation, focus |
| `--color-accent-hover` | `#183C2D` | Primary hover |
| `--color-accent-soft` | `#E7EFE8` | Selected navigation and spending group badges |
| `--color-danger` | `#A12C31` | Errors, destructive actions, overspending |
| `--color-danger-soft` | `#FBECEE` | Error and overspending backgrounds |
| `--color-warning` | `#795317` | Review-required messages |
| `--color-warning-soft` | `#FFF3D8` | Possible duplicate and uncategorized alerts |
| `--color-focus` | `#214E3B` | Visible keyboard focus |

Color communicates alongside text or an icon. Expense amounts use the normal text color; ordinary spending is not an error. Refunds and income have a plus sign and a kind label. Red is reserved for overspending, errors, and destructive actions.

Use `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No external font dependency is required. Amounts and numeric columns use tabular figures.

| Type role | Desktop | Phone | Weight and line height |
| --- | --- | --- | --- |
| Page heading | 28px | 24px | 600, 1.25 |
| Panel heading | 18px | 18px | 600, 1.35 |
| Summary amount | 32px | 28px | 600, 1.2 |
| Body and field value | 16px | 16px | 400, 1.5 |
| Table body and button | 14px | 16px for editable controls | 400 or 600, 1.45 |
| Supporting label | 13px | 13px | 400 or 600, 1.4 |

Spacing uses 4, 8, 12, 16, 24, 32, and 48px. Panels and dialogs have a 12px radius. Inputs and buttons have an 8px radius. Small status badges may use a full radius. Panel borders are 1px. Panels have no shadow. Menus and dialogs may use `0 12px 40px rgb(32 42 36 / 12%)`.

## App shell and responsive layout

Breakpoints are based on CSS viewport width:

| Width | Shell | Page layout |
| --- | --- | --- |
| 1024px and above | Fixed 232px left sidebar; 72px top bar in the remaining width | 32px page padding; content up to 1280px wide |
| 768px to 1023px | 200px sidebar; 64px top bar | 24px padding; two summary columns; content panels stack |
| Below 768px | Sidebar becomes a modal navigation drawer opened by a labeled Menu button; 64px top bar | 16px padding; one content column; two summary columns only when each stays at least 160px wide |

Desktop pages scroll vertically as a document. The sidebar and top bar remain available without covering content. Avoid nested page scroll areas. Tables and import previews may have their own horizontal scroll on larger screens. At 320px, the page itself has no horizontal overflow.

The sidebar contains Homebooks and this navigation order: Overview, Transactions, Amount owed, Budgets, Import, Settings. Active navigation has a pale green fill, dark green text, and a 3px left indicator. Use one consistent outline icon family at 18 to 20px, with a visible text label. The user menu and a secondary Switch sheet action are at the bottom. Sheet selection and creation are absent from the primary navigation.

Switch sheet opens a dialog showing the current sheet and its sharing state. It offers existing sheets and Create sheet. Create sheet asks for name and currency, explains that currency cannot change after transactions exist, and starts with the current user as owner. Switching sheets resets sheet-scoped filters and open editors and routes to that sheet's Overview. Switching away with a dirty editor triggers the unsaved-changes dialog.

The top bar identifies the current sheet, shows the currency, and contains global Invites with a pending count. Owners also see Share. Add transaction is the primary action on money pages. On phones, the bar contains Menu, the sheet name, and Invites. The page heading row contains Add transaction and owner-only Share with visible labels. Menu opens page navigation, with Switch sheet as a secondary footer action. There is no bottom navigation or floating button overlapping content.

Usual page URLs are `/overview`, `/transactions`, `/owed`, `/budgets`, `/import`, and `/settings`. The server resolves the remembered sheet from the HttpOnly selection cookie and checks current access on every request, falling back to an accessible sheet when the remembered selection is unavailable. Switching and creation save the selection, then open Overview with the current month; sheet-bound drafts and loaded content reset on switching. Explicit sheet IDs remain in API endpoints so an open page always reads and writes its rendered sheet even when another tab changes the remembered selection. Existing `/sheets/:id` links authorize access and select that sheet before opening the corresponding simple page URL, preserving query parameters. Simple URLs represent the current selection rather than a permanent link to a particular sheet.

Canonical pages share a persistent layout for the sidebar, sheet name, and header controls. Each destination still resolves the authorized remembered sheet and supplies a fresh shell snapshot before browser paint; the cached layout is never the identity authority for page data. Sheet-ID keys reset the shell and editors when identity changes. Sheet switching broadcasts invalidation to other open tabs; returning focus refreshes the router cache, including prefetched destinations. Known permission loss immediately clears financial content and editors.

During page and month navigation, retain the complete revealed heading, date range, and body until the destination is ready. The activated sidebar item receives an immediate outline; after 180 ms a small fixed Updating view indicator appears without shifting content. Pending work is announced accessibly. Use an unkeyed layout Suspense boundary, with no per-page loading boundary that replaces revealed content. Cold loads reserve three summary cards for Overview and Budgets, two for Amount owed, the Overview budget/spending group panels and recent ledger, and Transactions filters with six-column rows that stack into phone cards. Skeletons contain no fictional values. Initial Overview, Transactions, Budgets, Amount owed, Settings budgets/people, and resumed import data are read on the server before displaying the destination. CSV import format choices remain browser-driven because their preferences live in browser storage. Hover and keyboard focus enable full Link prefetch for the selected sidebar destination, including its initial data; avoid prefetching all financial screens eagerly.

Same-query financial refreshes retain existing rows and figures with a small delayed updating status. Replace related figures together when the response completes. Changed ledger/repayment filters skeletonize affected records. Month changes retain the prior complete view; budget-cycle mismatches hide affected values until refreshed. Destination failures offer Retry within the shared shell. Preserve all existing import draft and optimistic edit-conflict guards.

Each page starts with its title, a short description when useful, and page controls. Month-sensitive pages show a month picker at the right on desktop and below the heading on phones. The month is written October 2026, not an ambiguous numeric date. Overview and Budgets share the selected month for the active sheet. Transactions starts with that month but can change to another range. Import shows its own source dates.

Overview and Budgets show the selected cycle's full start and end dates below the heading, followed by Both dates included. The month picker label remains Selected month and names the month in which the cycle starts. Current month selects the cycle containing today's calendar date, including the preceding start month before its boundary. Transactions initially uses those inclusive dates; explicit date filters and Clear filters retain their existing behavior. Loading and configuration-revision mismatch hide financial values until dates and amounts agree.

## Shared components

Overview and Budgets use a shared month picker with a visible Selected month label and a segmented control: Previous month, a calendar icon and full month/year trigger, and Next month. The trigger opens a 288px panel below the control, aligned right on desktop and left on phones. The panel contains previous/next year controls, a three-column grid of twelve abbreviated months, and Current month. The selected month has a dark green fill; each month has its full month/year accessible name and pressed state. Years follow the supported 1000–9999 range. Changing months retains the active sheet and page. Pending navigation disables repeat activation and announces loading. Escape restores focus to the trigger; outside clicks and leaving the control by keyboard dismiss the panel. Controls remain at least 44px high. The panel uses surface, border, radius, focus, and menu shadow tokens, and fits at 320px without page overflow.

| Component | Contract |
| --- | --- |
| Primary button | Dark green fill, white text, 44px minimum height, 16px horizontal padding, explicit action label |
| Secondary button | White fill, control border, dark text; same height as primary |
| Destructive button | Red text and outline, or red fill in a destructive confirmation dialog |
| Text action | Underlined text or a button with a visible hover background; at least a 44px touch target |
| Input and select | Visible label above, 44px minimum height, white fill, control border, hint below when needed |
| Panel | White surface, fine border, 12px radius, 24px desktop or 16px phone padding |
| Status badge | Small text plus light fill; the label describes the state independently of its color |
| Amount | Right-aligned in rows, tabular figures, currency formatting, no truncation |
| Inline message | Text with an icon where helpful; error and warning colors follow the tokens |
| Empty state | Panel heading, one sentence explaining the state, and one action that resolves it |
| Toast | Confirms a completed noncritical action; never contains the only error or next step |

Focus uses a 2px dark green outline with a 2px offset. Buttons remain identifiable when disabled. Pending mutations retain the button label, add a small progress indicator, and prevent repeat submission. Validation errors appear beside their fields and in a form-level summary when several fields fail. Preserve values after a failed save.

Desktop transaction editors appear as a 520px right-side modal drawer. Share and destructive confirmations use centered dialogs up to 480px wide. On phones, editors and Share become full-screen dialogs with a heading, Close action, scrolling body, and a safe-area-aware footer. Save and Cancel remain reachable without covering the last field.

Dialogs trap focus, restore focus to their trigger, and support Escape when idle. An open dialog blocks scrolling on the background page. Its body scrolls internally while the heading and Close action remain visible. Clicking outside a dialog requests the same close action as Close or Escape; dragging from inside to outside does not dismiss it. Closing a dirty editor asks Discard changes? with Keep editing and Discard changes. During a commit, prevent accidental dismissal and show the pending operation. Do not nest dialogs. Open member management in Settings after closing Share.

## Overview

The page heading is Overview, followed by Track this sheet's spending for the selected month. Its sections appear in this order:

1. Three summary panels for sheets with transactions: Net spending, Remaining in budgeted spending categories, and Uncategorized spending. On desktop they share one row. Net spending has a subtle accent edge and the largest amount; secondary summary amounts are smaller. The remaining panel also shows budgeted spending and total limits. Uncategorized links to the filtered ledger.
2. Spending category budgets on the left and Spending by group on the right, in a roughly 2:1 desktop grid. On smaller screens the panels stack in that order.
3. Recent transactions when present, newest effective date first, with View all linking to Transactions.

Budget rows show spending category, net spent, limit, remaining or overspent, and a horizontal progress bar. The bar caps visually at its track width, but the displayed numbers retain overspending. A red label says $20.00 overspent. If refunds produce negative net spending, the bar starts at zero and text still displays the negative amount.

Spending group lists stable spending group names and their net expense totals. It includes Unassigned when nonzero. It does not label a spending group as owed, balance, or available cash. No pie chart is required.

If the sheet has no transactions, retain the heading and show No transactions yet with Add transaction and a secondary Import CSV action. Do not present missing budget limits as zero remaining. Show a single Spending category budgets panel with No monthly limits set, Set budgets, and a quieter Set default budgets link to Settings. Hide zero summary panels and empty spending group/recent panels for first use. If spending group has no rows, spending category budgets use the full width. When the selected month has no transactions, show $0.00 spending with No transactions this month, rather than the first-use message.

## Transactions

The heading is Transactions. The toolbar contains a search field and filters for effective date range, transaction account, kind, spending category, and spending group. The search label is Search payees. Show active filters and Clear filters. Phones show search and a Filters button; the filter form opens in a dialog and applies explicitly.

Desktop columns are Date, Payee, Transaction account, Spending category, Spending group, and Amount. Rows are at least 56px high. Kind appears below the payee or as a small badge. A split row displays Split across 2 spending categories or Split across 2 spending groups as applicable, with full details in its editor. Columns can show a single value when all splits share it. Row activation opens the editor; the payee also provides a keyboard-operable Edit action. Sorting initially uses newest date, then stable record order. Pagination shows a row range with Previous and Next; start with 50 rows per page.

Phones render transaction cards instead of a squeezed six-column table. Each card shows payee and signed amount, then effective date, transaction account, kind, spending category, and spending group. Long payees wrap. The card has a labeled Edit action. Transfers remain visible and say Excluded from spending.

The editor contains Kind, Date, Transaction account, Payee, Amount, and expense or refund allocation fields. Amount is a positive magnitude in the form. Kind determines its ledger sign; Transfer additionally requires Money in or Money out. Show the currency beside the amount. Expense and Refund offer Spending category and Spending group and a Split transaction action.

Split mode replaces the single allocation with rows containing amount, spending category, and spending group. Add split and Remove split are labeled actions. A footer shows the entered total and the remaining amount to allocate. Save is unavailable until allocations equal the parent amount, with visible explanatory text. A normal transaction still has one allocation. Income and Transfer omit allocation controls and explain that they do not affect spending budgets.

New manual transactions default to Expense, the browser's current date without timezone conversion, Uncategorized, and Unassigned. Existing records preserve their values. Transaction account is preselected only when there is exactly one active transaction account; otherwise require a choice. If no active transaction account exists, replace the form with an Add transaction account step, then return to the editor.

Deletion is available in the existing transaction editor and asks Delete this transaction? It explains that spending totals change and future imports will still recognize its source. It does not promise a full undo workflow. On a stale edit, preserve the unsaved values, show Someone updated this transaction, and offer Reload latest after confirmation that the local changes will be discarded.

No matching transactions shows Clear filters. A load failure shows Retry in the page panel. An authorization failure removes visible sheet data and routes to the sheet-access state.

## Amount owed

Amount owed shows all-time history with no month picker. A short scope note explains that only explicitly tracked spending group allocations count and that marking paid settles the entire expense. Summary panels show Tracked outstanding and Tracked paid back using the shared summary labels and amount typography. They have equal width in two columns, falling back to one column when either panel would be narrower than 160px. Desktop filters share one compact row; phone filters stack. Phone cards separate the wrapping payee and allocation with the shared transaction-card heading spacing. The Spending group filter starts at Tracked spending groups, offers individual tracked spending groups, and All expenses for comments and settlement on any expense. A Status filter offers All, Outstanding, and Paid back. List filters never change the clearly labeled all-tracked summary totals.

Manage tracked spending groups opens a dialog with labeled checkboxes for every spending group, including archived labels, and Save tracked spending groups. Nothing starts selected. Saving uses spending group versions; conflicts preserve selections and offer an explicit discard-and-reload confirmation. Untracking retains repayment dates and comments.

Expense rows group by spending group, showing that spending group's allocation amount rather than the full parent amount. A split expense may appear in multiple groups; its shared status, date, and comment stay consistent. Desktop columns are Expense date, Payee, Allocation, Status, and Actions. Phone cards retain these values with wrapping payees and comments. Groups show outstanding and paid allocation totals. History is paginated in 50 expense transactions; one parent and all displayed allocations stay on the same page. Summary totals cover all history.

Edit repayment opens the shared drawer with payee, expense date, full expense amount, Outstanding/Paid back status, repayment date for paid expenses, and an editable Comment field. Explain whole-expense settlement beside the status control. Save repayment updates status, date, and comment together. Reopening clears the saved date. Repayment dates before the expense date produce a field error. Saving disables repeated actions and dismissal. Dirty closing uses Discard changes; stale edits retain values and offer Reload latest with explicit discard confirmation. Deleted records preserve local entries and explain that the expense is unavailable. Access loss removes sheet data through the shared access state.

No tracked spending groups shows Choose tracked spending groups and explains opt-in. Empty tracked history explains that there are no expenses for those spending groups; filtered empty results offer Clear filters. Loading hides stale financial values. Load failures offer Retry. Shared tokens, dialogs, responsive tables/cards, permission handling, and 320px no-overflow behavior apply. Validate at 1440px and 390px, with an additional 320px overflow check.

## Budgets

The heading is Budgets with the selected month and Monthly limits for spending categories. Summary values show Total limits, Net spent in budgeted spending categories, and Remaining in budgeted spending categories.

The desktop table contains Spending category, Monthly limit, Net spent, and Remaining. Phone cards retain the same four values. Rows offer Set limit or Edit limit. Editing opens a small dialog with spending category, selected month, currency amount, Save limit, and Cancel. Recurring spending category defaults apply unless the selected month has an override. Label amounts Default or This month on both desktop and phone. If no default exists for the spending category, the editor offers Use this amount as the default for every month. If a default exists, show its amount and explain that saving changes only this month. An override offers Use default, including no limit when no default exists. Removing a limit confirms that the month's transactions remain.

Show unbudgeted active spending categories in a separate Spending categories without limits section, including their net spending and Set limit. A zero-dollar limit is a real limit and can be overspent. A missing limit says No limit. Overspending uses red text and the word overspent, without relying on the sign alone.

The screen has no envelope funding, available-to-assign balance, rollover controls, or spending group budgets. All spending groups count toward the spending category's spending.

## Import

The page heading is Import CSV. A labeled step indicator shows 1. File and transaction account, 2. Mapping, 3. Review, and 4. Result. It is a progress indicator, not a way to skip required validation.

File and transaction account selects the target transaction account and file. A bordered drop area also has Choose CSV file. File selection must work without drag-and-drop. Show the filename, file size, and selected transaction account. State the actual configured size and row limits near the chooser. The last-used active transaction account is selected automatically, falling back to the first active transaction account. For that transaction account, the last-used saved CSV import format is selected automatically, falling back to its first saved CSV import format. These preferences are stored in this browser per signed-in user and sheet; they contain only transaction account/profile identifiers. Missing, archived, and out-of-scope choices fall back safely. When browser storage is unavailable, first valid options still work. CSV import format loading blocks Continue to CSV import format and ignores stale responses after a transaction account change. Loading failures offer Retry saved CSV import formats and allow explicit mapping; first-time mapping remains explicit.

Saved CSV import format configuration starts collapsed and locked. Edit CSV import format reveals and enables its name, column mapping, date format, decimal format, and amount convention. View CSV import format settings reveals the same controls disabled; Hide CSV import format settings collapses them again. Choosing another CSV import format or saving a mapping locks and collapses it again. New explicit mappings show editable fields immediately. Validate CSV import format remains available for a locked CSV import format and always parses the current uploaded file. Missing saved columns show a warning listing their names and require Edit CSV import format or another CSV import format before validation. Saving preserves the existing optimistic profile-version conflict and explicit reload behavior. Mapping controls cover date, payee, amount or debit and credit, optional source ID, date format, decimal format, and sign convention. Before validation, five compact source samples are available. After validation, Parsed CSV rows lists every nonblank CSV record with at most 10 rows per page. Each clickable row shows its original CSV row number, transaction date, description truncated visually to about 32 characters, signed amount, and validation status or proposed kind. Full accessible descriptions are retained. A row opens the shared dialog with the complete parsed transaction and all original CSV fields; phones use the full-screen dialog. Pending validation retains the source list and shows the operation status. Failed validation preserves mapping choices and offers Validate CSV import format again.

When invalid records exist, a separate Invalid rows subsection lists them with their errors and independent pagination of at most 10 rows per page, including records beyond the first sample or current full-list page. Each opens the same detail dialog. Correction and explicit exclusion remain in Review. Completely empty or whitespace-only CSV records, including delimiter-only rows, are skipped automatically and counted separately. Original row positions and duplicate-import identity are preserved. A partially filled record remains subject to validation. A CSV containing only blank records has no data rows. Ambiguous values require a choice. Continue to review validates the mapping; it does not commit money records.

Review starts with the transaction account and counts for New, Already imported, Needs review, Invalid, and Excluded. Rows show source position, date, payee, kind, amount, allocation, status, and any keep-or-skip decision. Needs review shows why a row may match, and lets users inspect the existing transaction. Identical new rows remain separately visible.

Valid new rows are ready to import with their proposed values and protected default spending category/spending group, without individual review or saving. Users can optionally edit proposed kinds and allocations before confirmation. Invalid rows show their error and Correct or Exclude. Commit stays unavailable while required decisions or invalid rows remain unresolved. The action names the number being added, such as Import 8 transactions, and previews any excluded or skipped counts. A zero-new-row review says Nothing new to import and offers Done.

Review rows use one responsive form per row with directly visible Kind, row decision, spending category, and spending group. At desktop widths of 1280px and above, rows place compact identity/date/amount/status, four labeled controls, and actions in one horizontal band. Row spacing is 12px vertically with 8px control gaps; controls and buttons retain 44px minimum heights. Narrower desktop and 390px phones use two control columns; 320px uses one. Long payees wrap, and identity metadata shares a wrapping line. General kind guidance appears once above the list. Split-specific guidance, duplicate explanations, invalid errors, and conflicts remain beside their row. There is no second hidden set of editable controls. Save row review appears only while a row has unsaved edits and applies optional changes or explicit duplicate decisions; untouched rows show only Full review. Untouched valid rows do not require this action. Full review opens the guarded dialog for dates, payees, amounts, original source details, duplicate candidates, corrections, and exact splits. Multi-split rows show the split count and allocation summary; their inline Kind is disabled and allocations are changed only in Full review, preserving every split. Income and transfers show protected spending category/spending group defaults disabled and explain their spending exclusion and the Full review transfer direction control. Column mapping stacks. Commit uses a footer with the number of rows and enough safe-area spacing. Never hide a duplicate or validation decision to fit the screen.

Apply allocations appears above the review list with Spending category for eligible rows and Spending group for eligible rows dropdowns and Apply to eligible rows. Each dropdown starts with Keep each spending category/spending group; users can choose one or both active sheet labels. The controls explain that the operation covers the entire file, including other pages, only for valid kept single-split expenses and refunds. Exact splits, income/transfers, invalid rows, unresolved duplicates, skipped/excluded rows, definite duplicates/repeated files, and rows with an unavailable remaining allocation are skipped. Preserved fields include signed amounts and any allocation not selected. Success announces updated, skipped, and already-matched counts and explains that transactions are still uncommitted. Controls stack on phones with 44px targets. Pending operations, unsaved row drafts, missing batches, and uncertain import outcomes disable bulk changes. Batch-version conflicts preserve both choices and expose Reload latest review before Apply is available again. A changed ledger or organization snapshot returns a refreshed highlighted preview without allocation writes; choices remain selected and an explicit Apply retry uses the refreshed version. Bulk changes never silently resolve duplicates or discard row drafts.

Pending confirmation says Importing transactions. A stale preview says Data changed since this preview and returns the user to reviewed rows with the changed decisions identified. A failed confirmation leaves the review in place and offers Retry. If the outcome cannot yet be determined after a network failure, verify batch status before claiming failure or asking for another commit.

Result reports added, skipped, and excluded counts and offers View imported transactions. A repeated file clearly says This file was already imported. No bank-connect buttons, OFX/QFX chooser, or auto-categorization editor appear in this MVP.

## Settings

Use sections in this order: Sheet, Monthly budget cycle, Transaction accounts, Spending categories, Default budgets, Spending groups, People, and Your profile. Phones stack sections. Desktop uses a vertical page with labeled panels; avoid a second sidebar. Sheet settings refer to the selected sheet. Profile changes apply to the signed-in user across sheets.

Owner-only Sheet controls rename and delete the sheet. Currency is read-only after creation. Sheet deletion requires typing its name and explains that it removes this sheet's records for everyone. Membership removal uses a confirmation naming the affected person. Members see their role and Leave sheet instead of owner controls.

Monthly budget cycle is a shared Panel after Sheet. It shows Starts on day N each month, the current cycle's inclusive dates, short-month help, and owner-only Edit budget cycle. Members see the current setting and owner-only explanation. The shared guarded dialog provides a labeled Monthly start day select with days 1-31, an Example cycle showing both endpoints, and a Save budget cycle action. The end is calculated automatically as the day before the next monthly start. Explain that short months use their last day and later months return to the chosen day, with February 28/29 and March 31 examples. A warning states that changes regroup all reports, including past months; overrides retain their original start-month labels, and transaction dates and limit amounts stay the same. The example uses the current calendar month, so users can inspect the proposed start and end before saving.

Saving prevents repeated submission and dismissal. Failures preserve the choice. Stale configuration shows Someone updated the budget cycle with Reload latest; this asks before discarding the choice and fetching the latest setting. Saving remains unavailable until reload succeeds. Dirty closing, Escape, backdrop, focus restoration, keyboard access, pending states, phone dialog scrolling, and 44px controls follow shared dialog rules. At 1440px the setting row places action beside text; at 390px and 320px it wraps/ stacks with no page overflow.

Owner and members can add, rename, and archive transaction accounts, spending categories, and spending groups. Transaction account forms ask for name and source type, not credentials or balances. Protected defaults cannot be renamed or archived. Archived items retain historical display names and are unavailable for new allocations. The UI can restore an archived label without deleting its history.

People shows the owner, accepted members, and pending invitations. Owners can invite and revoke. Members can see who shares the sheet and leave. Profile allows display-name changes and sign-out; it shows username and email without inventing a account-recovery email flow.

An instance admin additionally sees a Backup status panel with last success, next scheduled attempt, and a failure message if needed. It explains that recovery uses the documented host commands and links to the documented host recovery instructions. It has no browser Download backup or Restore button. Non-admins do not see instance backup status.

Transaction accounts group transactions by source and hold saved CSV import formats. Explain that they do not track balances or require bank credentials. A CSV import format tells Homebooks how to read CSV columns, dates, and amounts. Spending groups can be people or groups without logins and are distinct from People, which controls sheet access. They do not track cash balances, savings envelopes, or amounts owed.

Settings explains spending categories as what was purchased (groceries, dining, gifts) and spending groups as whose expense it is (you, a partner, household). Include Groceries / Household as a concrete example, and explain the protected Uncategorized and Unassigned fallback labels. Names and protected/active/archive badges use a wrapping flex row with an 8px gap.

Default budgets lists each spending category’s recurring amount or No default limit with Set/Edit limit. Its dialog shows Every month, currency, save/remove, and conflict recovery. Explain that defaults apply to months without overrides, including past months. Removal preserves monthly overrides and transactions.

## Sharing and incoming invitations

Share opens with Invite someone to Family and the explanation Members can view and edit the whole sheet after they accept. Search results show display name and unique username, not private financial information. Every result has an Invite action. Sending changes its state to Invitation sent and prevents sending the same pending invite again.

Empty search says No matching people. Search failure is distinct from no matches and offers Retry. Search debounce and minimum query length can follow the selected implementation, but the UI must describe any minimum and must not show a server-wide user directory before a search.

Global Invites opens an incoming-invitations dialog. Each item shows inviter, sheet name, and Accept and Decline. There are no transaction account names, balances, or spending previews before acceptance. Acceptance adds the sheet to the switcher and offers Open sheet. Declining or a revoked invite removes it from pending items and explains the result.

With no accessible sheets, show a welcome page containing Create sheet and any incoming invitations. Users can accept invitations without creating a Personal sheet first. If access to the current sheet is revoked or the sheet is deleted, clear its rendered financial data and show This sheet is no longer available with Choose another sheet or Create sheet.

## Sign-in and registration

Unauthenticated screens use the canvas color with a centered white panel up to 420px wide, Homebooks above it, and 24px padding. Phones use a full-width panel with 16px outer margins. There is no authenticated navigation.

Sign-in has Email or username, Password, Show password, and Sign in. Registration has Display name, Username, Email, Password, and Create transaction account, and appears only when registration is enabled. Password rules come from actual auth configuration and appear before submission. A disabled-registration state explains Ask your household admin to enable registration. Password help explains the admin recovery process without offering a nonfunctional reset-email link.

First-instance setup includes the one-time setup token field and explains that this transaction account becomes instance admin. Setup is unavailable after initialization. Errors preserve entered identity fields without echoing passwords or setup tokens. Standard password-manager autocomplete and keyboard submission work.

## Dates, money, and copy

Transaction dates use unambiguous local presentation such as Oct 4, 2026. Parsing and storage retain date-only values. Amount formatting follows the sheet currency and appropriate minor-unit precision. The visual reference uses USD and US-English examples, not a requirement to hard-code two decimals for every currency.

Ledger amounts retain their signs. Overview and Budgets display net spending as a positive amount unless refunds exceed expenses. Label aggregate remaining values as applying to budgeted spending categories. Do not use cash balance, owed, saved, or safe to spend for spending group or spending limits.

Use sentence case and direct action names: Add transaction, Import CSV, Set limit, Invite, Accept, Decline, Leave sheet. Product messages describe the user-visible problem and next action. They do not expose database jargon, fingerprints, or server stack details.

## Loading, errors, and accessibility

Initial page loads use skeletons matching the final layout, without fabricated amounts. Changing the month marks the money panels busy until all displayed values belong to the new month. Do not briefly relabel the old month's totals as the new month. Prefer pessimistic money mutations: show confirmation after the server accepts the operation and refresh affected totals together.

Field errors are associated with their controls. Async success and error messages are announced to assistive technology. Tables have headers, dialogs have titles, nav marks the current page, and icon-only buttons have accessible names. All functions work by keyboard, and tap targets are at least 44px. Text and control states must meet WCAG 2.2 AA contrast requirements; verify the rendered component, not only the token palette. Honor reduced-motion preferences and avoid layout-shifting animations. Keep text and numeric values available without hover.

## Reference fixture

The visual reference uses Family, USD, October 2026, and spending group labels Ethan, Parents, and Unassigned. These are fixture values, not production defaults. It represents an owner with one accepted member.

| Transaction | Signed amount | Spending category | Spending group |
| --- | --- | --- | --- |
| Market purchase | -$100.00 | Groceries | Ethan $60.00, Parents $40.00 |
| Market refund | +$20.00 | Groceries | Ethan $20.00 |
| Electricity | -$120.00 | Utilities | Ethan $70.00, Parents $50.00 |
| Lunch | -$24.50 | Dining | Ethan $24.50 |
| Fuel | -$35.00 | Transport | Ethan $35.00 |
| Unreviewed purchase | -$18.50 | Uncategorized | Unassigned $18.50 |
| Card payment | -$100.00 | Excluded transfer | Excluded |
| Paycheck | +$2,000.00 | Excluded income | Excluded |

Net spending is $278.00. Spending group is Ethan $169.50, Parents $90.00, and Unassigned $18.50. Groceries, Utilities, Dining, and Transport limits are $150.00, $100.00, $100.00, and $60.00. Budgeted spending is $259.50 against $410.00 in limits, leaving $150.50. Utilities is $20.00 overspent. Uncategorized spending is $18.50 and has no limit.

## Handoff acceptance

### Implemented Overview

Overview shows net spending, remaining for budgeted spending categories with its spending and limit totals, Uncategorized spending, spending category budget progress, spending by group, and the five most recent transactions in the selected month. Its budget and ledger reads share one database snapshot. Unbudgeted spending contributes to net spending without inventing a remaining limit. Refund-only months retain negative net spending and group totals; progress starts at zero. Overspent progress caps at the track width while the text shows the complete amount. Archived labels remain visible in historical records.

The spending category and spending group panels use the reference's desktop 2:1 layout and stack on smaller screens. Recent transactions use the shared desktop table, phone cards, and guarded transaction editor. View all retains the month; Review uncategorized opens the ledger with that month and a visible, removable spending category filter. Add transaction retains month context and uses the normal entry defaults. First-use, empty-month, no-limits, skeleton, failed-load Retry, and revoked-access states display actual data without fixture defaults. The remaining summary says No limits set when no limits exist, including months that have spending. An explicit zero limit remains a real limit.

### Implemented monthly budgets

Budgets implements monthly spending category limits, three summary panels, desktop rows and phone cards, and a separate Spending categories without limits section. Set limit and Edit limit open the shared guarded dialog with exact currency amounts. Removing a limit confirms that transactions remain. An explicit zero remains a budget; missing and removed limits say No limit. Remaining calculations retain negative values; rows show the overspent magnitude and the word overspent in the danger treatment. Income, transfers, and deleted transactions are excluded by the same spending calculation that supplies the spending API.

Month changes reload the money panels together without displaying the previous month's values. Failed loads offer Retry. Failed saves preserve the entered amount; conflicting saves and removals require Reload latest with explicit confirmation before discarding local input. Archived spending categories with limits or net spending stay visible in historical reports. Existing archived limits remain editable and removable, while setting a new archived-spending category limit requires restoring the spending category in Settings. Recurring defaults apply where a month inherits its default. Explicit monthly overrides, including no limit, remain distinct. Unused budget amounts do not roll over.

### Implemented manual ledger

Transactions now implements the ledger and transaction editor contract above: six desktop columns, phone cards, 50-row pagination, explicit phone filters, exact signed currency amounts, split entry, conflict reload, deletion confirmation, and transaction account creation when no active transaction account exists. The ledger initially filters to the selected month; Clear filters includes all dates. An empty sheet says No transactions yet, while a sheet with records outside the selected month says No transactions this month. The selected month remains in navigation URLs when opening the editor from Overview or Budgets, and new entries use the browser's current calendar date. Add transaction is available in the shared shell and the Transactions toolbar.

Overview and Budgets now implement their summaries and monthly limits as described above. Sharing implements the owner and member flows described in Sharing and incoming invitations. Archived organization items remain visible in filters and as retained choices in historical transactions; newly added allocations offer active items only.

### Implemented import workflow

Import CSV implements the four stages above with a file chooser, remembered transaction account/profile defaults, collapsed and locked saved source configuration, saved CSV import format versions, blank first-time mapping choices, and source samples beside validated parsed samples. A batch URL resumes a persisted review. Review uses the responsive inline forms described above and defaults to 50 source rows per page, with labeled 25/50/100 choices and Previous/Next controls both above and below the list. Counts describe the complete file. Fifty rows bounds rendering and phone scrolling; 100 lets users reduce paging for large files. Parsed CSV and invalid-row previews remain limited to 10 rows independently. Both review pagination controls show the same range and page number, disable unavailable navigation, and disable all pagination during mutations or uncertain outcomes. Page-size changes keep the previously first visible row in the resulting page. Page changes scroll to the top review navigation and move keyboard focus to the corresponding available action. Reloaded reviews clamp to a valid page. Row drafts live above pagination and are preserved across paging, page-size changes, and Reload latest review. A stale edited row keeps its choices visible, shows the latest saved values, and requires Use latest values or Keep my edits against latest before another save; a new possible duplicate then requires a fresh decision. Import confirmation stays disabled while any row drafts remain. Opening Full review for a drafted row offers Keep editing or explicit discard for that row only; other drafts remain. Choosing another file, following another page link, or opening People settings through Share prompts before discarding drafts. Browser unload uses the standard unsaved-changes prompt. Pending saves disable row controls, pagination, and confirmation. Row correction, optional kind edits, duplicate choices, and exact split edits use the shared guarded transaction drawer. Kind has prominent guidance that card payments are Transfers and that income and transfers do not count as spending. Save row review applies optional changes without a separate acknowledgment checkbox. Correct row validates invalid source fields; a valid corrected row is ready to import with its proposed values unless a new possible duplicate requires a keep-or-skip choice. Actual invalid rows and unresolved duplicate decisions block confirmation; optional review never does.

Original imported fields and current matching transaction fields appear separately, including deleted matches. Candidate details disclose the first 20 of the full candidate count and show occurrence counts. Definite duplicates are inspectable and skipped. A stale preview highlights changed source rows, preserves proposals, and identifies decisions requiring another choice. CSV import format and row conflicts preserve local inputs until the user explicitly reloads.

Confirmation shows Importing transactions. A network failure triggers batch-status verification; unresolved status exposes Check import status and blocks another confirmation. Results report added, skipped, and excluded counts. View imported transactions opens the ledger without a month restriction and with a visible removable import filter; Clear filters removes that filter too. This implementation follows the existing tokens and reference components without material visual changes. The household confirmed its first export's Transaction Date spending date, ISO dates, positive debit/credit magnitudes, blank unused cells, period decimals, and lack of a stable source ID. First-time mapping remains explicit; compatibility checks use synthetic data and additional export formats remain unconfirmed.

### Shared shell, settings, and access

The shared responsive shell implements sheet selection and creation, role and currency display, period navigation, and the working Overview, Transactions, Amount owed, Budgets, Import, and Settings screens. Settings includes owner sheet rename/delete, transaction account/spending category/spending group organization, recurring default budgets, budget cycle configuration, and display-name editing. Page navigation uses the remembered authorized sheet. Switching sheets opens Overview in the current cycle and closes editors. Use the navigation and loading contract above for persistent shell behavior.

Global Invites is available even without sheets, shows the real pending count after loading, and offers accept/decline and Open sheet. The no-sheet welcome page also contains incoming invitations. Owner-only Share provides an explicit search with a two-character minimum, username disambiguation, pending invitation feedback, and a link to People settings. The complete MVP sharing, spending, settings, and summary contracts above remain unchanged. Auth and sheet creation reuse shared controls; modal creation retains entries through Keep editing, asks before dirty dismissal, and blocks dismissal during submission. Phone Menu uses the same native modal dialog behavior. Settings uses actual role, currency, organization, and accepted-user records. Its labeled panels use setting rows with actions that stack on phones. Organization editors use the same guarded native dialogs. People shows accepted members and, for owners, pending invitations. Owner revoke/remove and member leave actions require confirmation. Known sheet-access failures clear financial screens and open dialogs, remove the remembered selection, refresh route data, and offer a valid sheet or creation path. Accepted invitations update the switcher without requiring an existing personal sheet. Names are trimmed, limited to 80 characters, and unique per entity kind within each sheet, including archived names, using Unicode normalization and case-insensitive comparison. Subsequent screens reuse these primitives.

A UI handoff includes the implemented screens, any intentional deviations, and screenshots of the actual app at 1440px and 390px widths. Check 320px for page overflow and keyboard navigation at desktop width. The HTML reference is evidence of intended appearance, not proof that the app works.

Verify these behaviors on the implemented screens:

- Navigation order, active sheet, current page, owner/member controls, and global incoming invitations match this spec.
- Summary values, ledger rows, budgets, and spending group agree with the fixture and implementation-plan calculations.
- Long payees, large amounts, split rows, refunds, zero limits, missing limits, and overspending remain readable.
- Each implemented screen has empty, loading, failed-load, validation, and pending-save states where applicable.
- Transaction and budget conflict messages preserve unsaved inputs. Import ambiguity and uncertain network outcomes remain actionable.
- Phone layouts retain all form fields, duplicate decisions, signed amounts, and labeled actions.
- Shared components use the specified tokens. Focus, contrast, dialog behavior, and reduced motion are checked in the real app.
- Screens do not introduce deferred features or fake success states to fill empty space.

## Instance backup status

Instance administrators can open `/admin/backups` through Backup status in the desktop sidebar footer or phone Menu, including before creating a sheet. This global page uses the shared canvas, topbar, page heading, panels, badges, notices, and buttons. It has a Homebooks home link, Sign out, and Back to your sheets. It does not display a current sheet or imply that instance administration grants financial access. Its content is at most 960px wide, with the standard page padding at desktop, 390px, and 320px.

The Daily backups panel has a wrapping heading and Refresh status button, scheduler activity badge, and stacked labeled values for Last validated daily snapshot, Last failed check, Next scheduled check, and Status checked. Every timestamp is explicitly UTC; absent history says None recorded. State is fetched on entry and manual refresh, with a disabled pending refresh and loading notice. Network failure offers refresh. Missing, stale, stopped, or invalid scheduler status shows an unavailable warning with host process, storage, and logs guidance instead of old active times. No validated success shows a warning; a current failure explains five-minute retries and operator checks. A historical failure after a successful check remains visible with a recovery notice. In-progress checks keep prior history while the activity badge changes.

The Protect recovery copies panel explains full-instance sensitivity, off-host encrypted copies and auth-secret storage, and host-command export/restore. Browser download and restore controls are absent. API and page authorization independently require a current instance-admin grant; expired sessions redirect to sign-in and non-admin requests receive a permission notice/403. This view has no mutations, stale-edit conflicts, or sheet membership override. The visual reference's Backup status option illustrates the success state; fixtures remain illustrative.
