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
| `--color-accent-soft` | `#E7EFE8` | Selected navigation and person or group badges |
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

During page and month navigation, retain the complete revealed heading, date range, and body until the destination is ready. The activated sidebar item receives an immediate outline; after 180 ms a small fixed Updating view indicator appears without shifting content. Pending work is announced accessibly. Use an unkeyed layout Suspense boundary, with no per-page loading boundary that replaces revealed content. Cold loads reserve three summary cards for Overview and Budgets, two for Amount owed, the Overview budget/person or group panels and recent ledger, and Transactions filters with six-column rows that stack into phone cards. Skeletons contain no fictional values. Initial Overview, Transactions, Budgets, Amount owed, Settings budgets/people, and resumed import data are read on the server before displaying the destination. CSV import format choices remain browser-driven because their preferences live in browser storage. Hover and keyboard focus enable full Link prefetch for the selected sidebar destination, including its initial data; avoid prefetching all financial screens eagerly.

Same-query financial refreshes retain existing rows and figures with a small delayed updating status. Replace related figures together when the response completes. Changed ledger/repayment filters skeletonize affected records. Month changes retain the prior complete view; budget-cycle mismatches hide affected values until refreshed. Destination failures offer Retry within the shared shell. Preserve all existing import draft and optimistic edit-conflict guards.

Each page starts with its title, a short description when useful, and page controls. Month-sensitive pages show a month picker at the right on desktop and below the heading on phones. The month is written October 2026, not an ambiguous numeric date. Overview and Budgets share the selected month for the active sheet. Transactions starts with that month but can change to another range. Import shows its own source dates.

Overview and Budgets show the selected period's exact start and end dates below the heading, followed by Both dates included. The picker says Selected period and displays the start date with its day and year, such as October 20, 2026. Previous/Next period step through actual starts, including a second start in the same month. The month grid opens the first period starting in a month; when that month has two starts, list both exact start dates beneath the grid. Current period selects the cycle containing the UTC calendar date. Transactions initially uses the same inclusive dates; explicit filters and Clear filters retain their behavior. Loading and revision mismatch hide financial values until dates and amounts agree. Exact period starts remain in shared navigation URLs.

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

1. Three summary panels for sheets with transactions: Net spending, Remaining in budgeted spending categories, and Uncategorized spending. On desktop they share one row. Net spending has a subtle accent edge and the largest amount; secondary summary amounts are smaller. The remaining panel also shows budget used and total limits. Uncategorized links to the filtered ledger.
2. Spending category budgets on the left and Spending by group on the right, in a roughly 2:1 desktop grid. On smaller screens the panels stack in that order.
3. Recent transactions when present, newest effective date first, with View all linking to Transactions.

Budget rows show spending category, net spent, limit, remaining or overspent, and a horizontal progress bar. The bar caps visually at its track width, but the displayed numbers retain overspending. A red label says $20.00 overspent. If refunds produce negative net spending, the bar starts at zero and text still displays the negative amount.

Responsibility lists stable person or group names and their net expense totals. It includes Me when nonzero. It does not label a person or group as owed, balance, or available cash. No pie chart is required.

If the sheet has no transactions, retain the heading and show No transactions yet with Add transaction and a secondary Import CSV action. Do not present missing budget limits as zero remaining. Show a single Spending category budgets panel with No monthly limits set, Set budgets, and a quieter Set default budgets link to Settings. Hide zero summary panels and empty person or group/recent panels for first use. Show summary panels when upcoming-payment contributions or reconciliation exist even before the first transaction. If person or group has no rows, spending category budgets use the full width. When the selected month has no transactions, show $0.00 spending with No transactions this month, rather than the first-use message.

## Transactions

The heading is Transactions. The toolbar contains a search field and filters for effective date range, transaction account, kind, spending category, and person or group. The search label is Search payees. Show active filters and Clear filters. Phones show search and a Filters button; the filter form opens in a dialog and applies explicitly.

Desktop columns are Date, Payee, Transaction account, Spending category, Responsibility, and Amount. Rows are at least 56px high. Kind appears below the payee or as a small badge. A split row displays Split across 2 spending categories or Split across 2 people and groups as applicable, with full details in its editor. Columns can show a single value when all splits share it. Row activation opens the editor; the payee also provides a keyboard-operable Edit action. Sorting initially uses newest date, then stable record order. Pagination shows a row range with Previous and Next; start with 50 rows per page.

Phones render transaction cards instead of a squeezed six-column table. Each card shows payee and signed amount, then effective date, transaction account, kind, spending category, and person or group. Long payees wrap. The card has a labeled Edit action. Transfers remain visible and say Excluded from spending.

The editor contains Kind, Date, Transaction account, Payee, Amount, and expense or refund allocation fields. Amount is a positive magnitude in the form. Kind determines its ledger sign; Transfer additionally requires Money in or Money out. Show the currency beside the amount. Expense and Refund offer Spending category and Responsibility and a visible Divide this expense action. Its adjacent explanation says Divide the amount between spending categories or people and groups.

Manual entry and import Full review use the same controlled allocation fields. Opening division immediately shows two parts with blank amounts. The first keeps the selected spending category and person or group; the second uses protected Uncategorized and Me defaults. Do not guess amounts or fixture allocations. Existing multi-part transactions retain every amount and allocation when opened. Each numbered part has required amount, spending category, and person or group controls with visible required text. Enter positive amounts; the parent kind determines all ledger signs. Refund guidance explains that its parts reduce spending in the chosen categories and groups.

A muted bordered summary beside the parts announces Original total and Still to assign with exact currency precision as edits occur. When amounts exceed the total it says Over assigned by and explains reducing or removing a part. Incomplete, zero, negative, overprecision, and out-of-range amounts have associated field errors. Invalid parts remain editable and do not count toward the displayed remaining amount; nearby text explains this. Incomplete decimal strings stay in the draft rather than being rounded or cleared. Add another part adds a blank amount with protected defaults. Remove part N returns that part's amount to Still to assign, as explained beside the controls. At least one part remains; disable its removal. At 100 parts disable adding and explain the limit. Parts and summary stack within the shared drawer at desktop and phone widths, use 44px controls, and wrap at 320px. Save is unavailable until valid positive part amounts equal the parent amount, with visible explanatory text. Manual entry keeps Save transaction. Import retains raw parts in its parent session draft and submits them only with final Import. A normal transaction still has one allocation. Income and Transfer omit allocation controls and explain that they do not affect spending budgets.

New manual transactions default to Expense, the browser's current date without timezone conversion, Uncategorized, and Me. Existing records preserve their values. Transaction account is preselected only when there is exactly one active transaction account; otherwise require a choice. If no active transaction account exists, replace the form with an Add transaction account step, then return to the editor.

Deletion is available in the existing transaction editor and asks Delete this transaction? It explains that spending totals change and future imports will still recognize its source. It does not promise a full undo workflow. On a stale edit, preserve the unsaved values, show Someone updated this transaction, and offer Reload latest after confirmation that the local changes will be discarded.

No matching transactions shows Clear filters. A load failure shows Retry in the page panel. An authorization failure removes visible sheet data and routes to the sheet-access state.

## Amount owed

Amount owed combines expenses from explicitly tracked people and groups and standalone amounts, without a month picker. The scope note explains automatic expense inclusion and partial repayments. The primary Track people and groups button opens a shared guarded drawer with Responsibility, Automatically track this group's expenses, and required Who receives the repayments? fields. Save tracking includes existing and future expense portions; new groups default to enabled in this draft. Only custom groups can be selected, including archived groups labeled as such. No groups shows a Settings setup prompt. A Tracked people and groups panel lists each enabled group and recipient; legacy groups without a recipient visibly require setup. Disabling stops new additions while retaining debt/payment history; recipient changes affect newly added expenses. Errors preserve inputs, uncertain saves offer Retry same action, and conflicts offer explicit discard-and-reload. Tracking is available to owners and accepted members.

Add standalone amount opens the independent obligation drawer. Add from transactions is a separate secondary action for selecting ledger expenses manually. Combining existing outstanding amounts is handled directly from their cards. A Who owes? panel lists debtor names with all-date remaining totals and an All people and groups button. The active choice has a green border/fill, aria-pressed, and a Showing name label. Names match exact stored debtor names across every recipient; completed-only names remain selectable at zero. These are debt totals, distinct from ordinary Responsibility totals, and opposite directions are never netted.

Outstanding and Paid back are separate stacked sections. Outstanding includes every unpaid or partially paid agreement across all dates, ten per page, with a total remaining across all matching agreements. Paid back initially shows the latest ten completed agreements within UTC today minus three calendar months through UTC today, inclusive; subtraction clamps to the target month's last day. Completion descending and ID ascending break ties. The initial range is read on the server with both sections. Each section fetches only its requested page of summaries; full events/sources load when Details and history or Record repayment opens the drawer.

Paid back labels its applied completion-date range separately from draft Completed on or after and Completed on or before controls. Load history applies the controls and returns to page one. Blank bounds reach older history, including clearing both for all dates; reversed ranges show an error. The API accepts at most 100 records per request, while the UI uses ten per page. Counts, More matches available, Previous and Next remain visible and independently enabled per section. Paging preserves the active debtor and grouping selection. A stale empty page offers Return to first page. On phones date controls and amounts stack, direction wraps, and history remains in the same page flow.

Each section has its own busy, empty, failed-load and Retry states. Query changes immediately hide the previous query's records/totals; request sequence checks ignore stale successes and errors. An unchanged-query refresh retains complete prior values while busy. Saving refreshes both sections and clears grouping choices. Access loss clears both sections and dialogs. No status dropdown remains.

Amounts are nested under shared debtor/recipient headings, such as Parents 1 owes Me. Each heading shows the remaining total and count across every matching page, with an explicit page-count note when only some records are visible. Different descriptions remain individual amounts inside the same party group. This is display grouping; Combine selected remains an explicit optional merge. Each individual panel displays the wrapping description, explicit debtor owes recipient direction, total owed, paid so far, remaining, last update and status. Partial payments stay Outstanding; zero remaining is Paid back with completion date. Migrated entries with unknown recipients explicitly say Recipient needs clarification. A warning marks changed linked transactions. Outstanding cards have Select to combine checkboxes. Selection reveals a sticky panel inside Outstanding with selected count, Combine selected (N), and Clear selection. One selection prompts users to select another; combining requires at least two. Different debtors or recipients show an inline explanation and disable combining. Missing recipients and changed sources disable the affected checkbox with a visible explanation. Selections persist across pages; choosing a different person clears them. Paid-back cards have no combine checkbox. Tracked People and groups appear above the person filter. Unknown recipients offer Set repayment recipient. The empty Outstanding state directs users to track a person or group or add a standalone amount.

Add standalone amount opens the guarded shared drawer with Description, Who owes?, Who receives the repayment?, currency-labeled Total owed and Some of this amount was already repaid. The latter reveals an explicitly labeled opening amount/date/comment and creates its own history event. Who owes? and Who receives the repayment? use shared spending-group dropdowns, with Me preselected as the recipient. Add person or group… reveals a required New person or group name field. Its hint explains that saving the form also saves the group for use in transactions. Tracking recipient and manual transaction-based agreement fields use the same control. Active groups are listed; the current saved name remains selectable for historical entries. New groups are created atomically with the action, and normalized existing names are reused. People/group names need no login. Independently agreed obligations must not copy already claimed portions.

Details and history opens a drawer showing the same amounts/direction/update, immutable payment/opening/correction events, comments, reasons and agreement review history. Edit agreement requires explicit parties and a change reason. Linked totals change through source review. Each outstanding card with a known recipient has a primary Record repayment action opening the payment form directly. The amount defaults to the full remaining amount; entering a smaller amount records a partial repayment. The form explains this and that spending totals stay unchanged. Record repayment asks amount/date/comment; overpayments remain rejected. Correct repayment selects an original event, replacement amount/date/comment and a reason; zero voids it. The original and correction remain visible.

Linked sources expand to show original and acknowledged revisions, immutable source snapshot, current portion value, kind/deletion status and preserved legacy paid-date/comment. Inspect original transaction and allocations opens an authorized source page, including retained deleted records. Ledger editors link to the same page so untracked legacy metadata remains reachable. Review linked sources shows Keep agreed or Adopt current, agreed/proposed totals and paid so far before a reason and explicit confirmation. Explain that edited positions may represent different allocations and that edited transactions cannot be claimed again. Deleted/refunded sources remain in provenance after acknowledgment.

Combine selected opens a focused shared modal and automatically previews only the selected debts. It shows their names and remaining amounts, debtor/recipient, total owed, already repaid and remaining. Parties are derived from the selection, and the only editable field is Name for the combined amount, prefilled from the debtor. Combine amounts confirms directly; Cancel leaves selection intact. No transaction picker or separate preview step appears. The modal explains preservation of repayment history and the unchanged total balance. Loading, retry, unknown outcome, conflict reload and dirty draft protection use the shared contracts. Conflict reload explicitly discards the draft and clears stale selection. The sticky panel uses the shared accent-soft background and border, stays below navigation, and wraps actions on phones.

The separate Add from transactions drawer lists a paged source picker. Each source has payee/date/Responsible for/portion/amount, Inspect source transaction, Include this portion and Include whole expense. A whole selection replaces that transaction's portion selections. Selection survives source pagination. Explicit description/debtor/recipient fields precede Preview grouped agreement. The preview enumerates every included source/debt, combined total, paid and remaining before Confirm grouped debt. Existing debts need matching explicit direction and resolved source reviews. Exclusive claims and current versions are rechecked atomically on confirmation.

Shared tokens, wrapping actions and stacked phone amounts apply at 1440px, 390px and 320px. Debt checkbox labels, source links and history disclosure summaries each provide at least a 44px-high activation target; wrapping labels retain the full target. Drawers use labeled required fields, pending-save dismissal protection, dirty discard confirmation, announced errors and preserved values. Unknown network outcomes lock the draft and offer Retry same action using the same idempotency key. Conflicts offer Reload latest with explicit discard confirmation. Access loss clears financial data/dialogs. Cold loads use skeletons without fictional amounts; unchanged-query refreshes retain prior complete values until refreshed together. Source/debt empty states, load failures and Retry remain distinct. Source inspection uses a maximum 960px content area, 32px desktop padding and 16px phone padding.

## Budgets

The heading is Budgets with the selected month and Monthly limits for spending categories. Summary values show Total limits, Budget used in budgeted spending categories, and Remaining in budgeted spending categories.

The desktop table contains Spending category, Monthly limit, Budget breakdown, and Remaining. Phone cards retain recorded spending, the same breakdown and remaining. Rows offer Set limit or Edit limit. Editing opens a small dialog with spending category, selected month, currency amount, Save limit, and Cancel. Recurring spending category defaults apply unless the selected month has an override. Label amounts Default or This month on both desktop and phone. The editor offers Also change the recurring default from the current period onward. Show the selected period's effective default. When selected past or future, explain that its explicit amount changes separately while the default starts at the actual current period. An override offers Use default, including no limit when no default exists. Removing a limit confirms that the month's transactions remain.

Show unbudgeted active spending categories in a separate Spending categories without limits section, including their net spending and Set limit. A zero-dollar limit is a real limit and can be overspent. A missing limit says No limit. Overspending uses red text and the word overspent, without relying on the sign alone.

The screen has no envelope funding, available-to-assign balance, rollover controls, or person or group budgets. All people and groups count toward the spending category's spending.

### Upcoming payments and budget breakdown

Budgets adds an Upcoming payments panel after category limits. Its introduction explains that Planned contributions reduce category availability and do not prove saved or transferred cash. Plan upcoming payment opens the shared guarded dialog with required name, currency amount, next payment date and Spending category, plus recurrence. Choices are One payment, Monthly, Every six months and Annually. Confirm next upcoming payment reuses the fields and preserves the intended recurrence day when a proposed clamped date is accepted.

Each plan has a wrapping name, expected amount, category, due date, recurrence and status. A disclosure lists exact inclusive period dates and Planned contributions with any dated reconciliation. Explain that only remaining periods share the amount, late starts raise contributions and the due-date period is included. Overdue, Cancelled, Skipped and Payment matched are explicit text states. Cancelled/skipped plans remain in a history disclosure. Active plans offer Edit, Match payment, Skip payment and Cancel plan. Fulfilled plans offer Release match and, when eligible, Plan next payment with proposed date and skipped-past-occurrence count.

Budget breakdown disclosures in both Budgets and Overview show Budget used, Recorded spending, Planned contributions, Reconciliation and Matched expense excluded. State their equation and explain that recorded spending retains full amount/date. Category bars and remaining use budget used. Overview net spending and Spending by group remain actuals. Categories without limits also show the breakdown when planning applies. Empty sheets retain first-use guidance, but real planning can show availability before recorded transactions exist.

Match recorded payment explains whole-expense eligibility beside the picker. Every split must use the plan category, its recorded timestamp must follow plan creation, and its date must be within the current UTC period through today. No eligible payments explains recording the payment after the plan is created. Confirm match describes uncovered cost, actual differences, retained contributions and stopped future contributions. Skip/cancel confirms current releases and unchanged completed history. Release confirms ordinary spending, current reversal and possible explicit rematching.

Changed sources show Needs review with original snapshot and current kind/payee/date/amount/categories. Explain the retained agreed plan charge, live expense exclusion and ordinary separate refunds. Release match is explicit; no automatic adoption or refund inference occurs. Settings cycle previews list before/after schedules and retained completed amounts for active plans before the owner saves.

Use shared panels, fields, dialogs, notices, loading states and green tokens. Payment-plan actions wrap on desktop. Below 768px, plan-card and plan-form actions stack as full-width buttons with readable wrapping labels. The panel heading action also takes the full width. All buttons and disclosure summaries, including cancelled/skipped history, have at least 44px activation height at 1440px, 390px and 320px. Pending saves disable controls/dismissal. Unknown outcomes lock the exact submitted draft and offer Retry same action; no changed payload can create a duplicate. Conflicts retain visible fields with disabled save until explicit Discard draft and reload latest. Load failures offer Retry. Access loss clears plan data/dialogs. Empty/loading/error/member/conflict states require actual-app validation and screenshots.

## Import

The page heading is Import CSV. A labeled step indicator shows 1. File and transaction account, 2. CSV import format, 3. Review, and 4. Result. It is a progress indicator, not a way to skip required validation.

File and transaction account selects the target transaction account and file. A bordered drop area also has Choose CSV file. File selection must work without drag-and-drop. Show the filename, file size, and selected transaction account. State the actual configured size and row limits near the chooser. The last-used active transaction account is selected automatically, falling back to the first active transaction account. For that transaction account, the last-used saved CSV import format is selected automatically, falling back to its first saved CSV import format. These preferences are stored in this browser per signed-in user and sheet; they contain only transaction account/profile identifiers. Missing, archived, and out-of-scope choices fall back safely. When browser storage is unavailable, first valid options still work. CSV import format loading blocks Continue to CSV import format and ignores stale responses after a transaction account change. Loading failures offer Retry saved CSV import formats and allow explicit mapping; first-time mapping remains explicit.

Saved CSV import format configuration starts collapsed and locked. Edit CSV import format reveals and enables its name, column choices, date format, decimal format, and amount convention. View CSV import format settings reveals the same controls disabled; Hide CSV import format settings collapses them again. Choosing another format or explicitly updating it locks and collapses settings again. New configurations show editable fields immediately. Selecting a saved format automatically checks the actual uploaded file and shows interpreted rows. Show Checking CSV import format against this file while pending, retain source samples, and display actionable check errors. Invalidate results after any file, transaction account, format, or configuration change. Continue to review is the primary action and runs outstanding checks. There is no separate Validate action or prerequisite save.

Remember this format for future imports is an optional checkbox for new configurations, with a name required only when remembering. Explain its reuse purpose beside the checkbox. Selected saved formats explain that changes apply only to this import. Update saved CSV import format is a separate explicit secondary action with optimistic version checks. Conflicts preserve choices and offer explicit Reload saved CSV import format; local choices can still continue to review without overwriting the saved format. Keep remembered transaction account/profile preferences. Required controls include accessible required text and adjacent guidance for missing choices, missing columns, and repeated column assignments. Missing saved columns list their names and offer editing or a different format.

Setup begins with Tell Homebooks where to find the transaction details in your file. Use everyday labels and explained required/optional text, including the optional saved format selector. Each heading option pairs the actual uploaded heading with a compact actual value; beside the selected control, show up to three distinct sample values, with Blank explicitly labeled. Full selected examples wrap without truncation. Explain spending versus posting date, description, and optional stable transaction IDs. Date and money settings repeat relevant file samples beside the control. Explain day/month ambiguity explicitly, sign preservation or reversal, positive debit/credit magnitudes, unused blank/zero cells, decimal separators, and sheet currency. Do not infer choices from examples. Required controls use aria-required and associated actionable errors. Missing choices and missing saved headings have guidance beside Continue to review; individual invalid rows can still proceed to correction or exclusion.

Above the paged preview, Compare your file with Homebooks pairs the first three source rows with their interpreted spending date, description, signed amount, and proposed kind. Original headings and values remain visible beside interpreted values at desktop width. Before checks, show current selected source values and guidance instead of a fabricated transaction; invalid examples show errors and the correction path. On phones each source/result pair stacks in the same order with wrapping values. Keep saved settings collapsed and locked until explicitly inspected or edited.

Controls cover date, payee, amount or debit and credit, optional source ID, date format, decimal format, and purchase sign convention. Five compact source samples are available before checks. Parsed CSV rows lists every nonblank record with at most 10 rows per page, including its original row number, transaction date, description truncated visually to about 32 characters, signed amount, and status or proposed kind. Full accessible descriptions remain. A row opens the shared dialog with the complete parsed transaction and original CSV fields; phones use the full-screen dialog. Invalid rows can continue to correction/exclusion in Review.

When invalid records exist, a separate Invalid rows subsection lists them with their errors and independent pagination of at most 10 rows per page, including records beyond the first sample or current full-list page. Each opens the same detail dialog. Correction and explicit exclusion remain in Review. Completely empty or whitespace-only CSV records, including delimiter-only rows, are skipped automatically and counted separately. Original row positions and duplicate-import identity are preserved. A partially filled record remains subject to validation. A CSV containing only blank records has no data rows. Ambiguous values require a choice. Continue to review validates the mapping; it does not commit money records.

Review starts with the transaction account and counts for New, Already imported, Needs review, Invalid, and Excluded. Rows show source position, date, payee, kind, amount, allocation, status, and any keep-or-skip decision. Needs review shows why a row may match, and lets users inspect the existing transaction. Identical new rows remain separately visible.

Valid new rows are ready to import with their proposed values and protected default spending category/person or group, without individual review or saving. Users can optionally edit proposed kinds and allocations before confirmation. Invalid rows show their error and Correct or Exclude. Commit stays unavailable while required decisions or invalid rows remain unresolved. The action names the number being added, such as Import 8 transactions, and previews any excluded or skipped counts. A zero-new-row review says Nothing new to import and offers Done.

Review rows use one responsive form per row with directly visible Transaction type, Import action, Spending category, and Responsibility. At 1280px and above place compact identity/date/amount/status, four labeled controls, and actions in one horizontal band. Keep 12px row spacing, 8px control gaps, and 44px control targets. Narrow desktop and 390px phones use two control columns; 320px uses one. Long values wrap. There is one visible set of inline controls. Full review opens the shared drawer for dates, payees, amounts, original details, duplicate candidates, raw corrections, and exact splits. Multi-part pending drafts show their actual part count and allocation summary; edit their type and allocations in Full review. Income/transfers show protected allocations and explain spending exclusion. No row-save action appears. Closing Full review keeps all raw incomplete edits. Manual entry retains Save transaction. Import actions read Import as a new transaction, Do not import this row, and for valid sources Do not import, count this occurrence. The latter skips a source while retaining occurrence counting; exclusion removes it from subsequent source occurrence matching. Neither creates a transaction.

Apply allocations appears above the review list with category/group dropdowns and Apply to eligible rows. Keep each spending category/group is the initial choice. Explain that it creates pending edits across the entire file only for untouched valid kept single-part expenses/refunds. Every row with an existing draft is preserved, including incomplete fields and corrections. Exact splits, income/transfers, invalid/unresolved rows, skipped/excluded rows, definite duplicates, and repeated files stay unchanged. Announce updated and preserved-draft counts and Nothing has been imported. The final Import applies all allocations through its atomic operation. Controls stack on phones with 44px targets. Pending operations, missing batches, and uncertain outcomes disable bulk changes.

Pending confirmation says Importing transactions. A stale preview says Data changed since this preview and returns the user to reviewed rows with the changed decisions identified. A failed confirmation leaves the review in place and offers Retry. If the outcome cannot yet be determined after a network failure, verify batch status before claiming failure or asking for another commit.

Result reports added, skipped, and excluded counts and offers View imported transactions. A repeated file clearly says This file was already imported. No bank-connect buttons, OFX/QFX chooser, or auto-categorization editor appear in this MVP.

## Settings

A fresh sheet has one Start your sheet panel with Start setup as its primary action and Skip setup as a secondary action. Do not display the old equal-weight configuration checklist. The guide uses the shared guarded dialog: Step 1 of 2 · Choose an account, then Step 2 of 2 · Add your first transaction. Account creation reuses the manual editor's real account form with name and source type; an existing active account can be chosen instead. Continue advances only after a valid account exists. The next task offers Enter one transaction or Import a CSV; Back returns to account selection. Entry uses the real editor or CSV stages and preserves the selected account. If an import draft exists, changing accounts requires explicit discard; continuing the same account preserves it.

The active reminder names only the current task and offers Resume setup. Skipped guidance stays hidden across reload and login in the same browser, scoped to the stable user and sheet. A text Help button on every page opens optional one-sentence guidance with a concrete next action and Start/Resume setup while unfinished. Help is available on completed sheets without another tutorial. Do not flash a fresh reminder before personal browser preferences load. Browser-storage failure falls back to memory during navigation.

Show verified first-entry results: Transaction saved with its description, or the actual imported count, followed by View transactions and Done. Failed writes and zero-added imports never show completion. An active guide completed by someone else says This sheet has its first transaction. Viewing the result or Done dismisses the personal success panel. Shared persisted completion is never reset. Optional customization stays in collapsed Customize later links for categories, People and groups, budgets, and owner-only budget cycle. Settings retains `#sheet-setup` as a compact optional-links destination, without a task checklist.

Keep selected paths across navigation and reload, return archived/missing accounts to Step 1, and preserve real account/transaction/import drafts on recoverable errors. Account dialogs confirm dirty close and block pending close; real entry and import keep existing dirty-navigation and conflict handling. Expanded Help and choice buttons wrap at 390px and stack where needed; minimum targets remain 44px. Same-sheet refresh keeps editor identities and pending import state. Opening a manual-entry link consumes its one-time add/account selection query while retaining period, filters, and hash, so reload does not reopen a blank draft over the saved result.


Use sections in this order: Sheet, Budget cycle, Transaction accounts, Spending categories, Default budgets, People and groups, People, and Your profile. Phones stack sections. Desktop uses a vertical page with labeled panels; avoid a second sidebar. Sheet settings refer to the selected sheet. Profile changes apply to the signed-in user across sheets.

Owner-only Sheet controls rename and delete the sheet. Currency is read-only after creation. Sheet deletion requires typing its name and explains that it removes this sheet's records for everyone. Membership removal uses a confirmation naming the affected person. Members see their role and Leave sheet instead of owner controls.

Budget cycle is a shared Panel after Sheet. Show Monthly start day N, the current period dates, and owner-only Edit budget cycle. The shared dialog contains Monthly start day and an unchecked Only affect future cycles checkbox. Unchecked copy states that current and previous cycles also change; checked copy states that current and previous cycles stay unchanged. Show only Current cycle after saving or First future cycle with its inclusive dates. A collapsed How this affects budgets disclosure explains retained transaction dates, exact saved limits, clamping and plan rescheduling. Do not expose an effective date, transition selector, five-period comparison, large warning paragraph or separate preview button.

Save budget cycle performs the authorized check and optimistic save in one click. Pending requests disable edits and dismissal; failures preserve choices. Conflicts offer Reload latest with explicit discard confirmation. Unchanged closing needs no discard prompt; changed controls follow shared dirty-dialog protection. Success distinguishes all-period changes from future-only changes. The controls wrap at 390px and 320px and checkbox activation stays at least 44px. Members see the cycle dates without edit controls.

Owner and members can add, rename, and archive transaction accounts, spending categories, and people and groups. Transaction account forms ask for name and source type, not credentials or balances. Protected defaults cannot be renamed or archived. Archived items retain historical display names and are unavailable for new allocations. The UI can restore an archived label without deleting its history.

People shows the owner, accepted members, and pending invitations. Owners can invite and revoke. Members can see who shares the sheet and leave. Profile allows display-name changes and sign-out; it shows username and email without inventing a account-recovery email flow.

An instance admin additionally sees a Backup status panel with last success, next scheduled attempt, and a failure message if needed. It explains that recovery uses the documented host commands and links to the documented host recovery instructions. It has no browser Download backup or Restore button. Non-admins do not see instance backup status.

Transaction accounts group transactions by source and hold saved CSV import formats. Explain that they do not track balances or require bank credentials. A CSV import format tells Homebooks how to read CSV columns, dates, and amounts. People and groups can be people or groups without logins and are distinct from People, which controls sheet access. They do not track cash balances or savings envelopes. Amount owed offers opt-in repayment tracking for selected groups.

Settings contextual help explains categories as what was purchased and people and groups as whose spending it is. Keep examples and fallback explanations in optional help. Names and protected/active/archive badges use a wrapping flex row with an 8px gap.

Default budgets lists each spending category’s recurring amount or No default limit with Set/Edit limit. Its dialog shows the exact effective current period start, currency, save/remove, and conflict recovery. Default changes begin at that start and continue into future periods; earlier limits remain. Show the actual current explicit override amount or Explicit no limit and say it remains unchanged. An unchecked Replace the current period override with this default option returns it to inheritance only when explicitly selected. Future overrides remain. Removal has the same scope and replacement choice, leaving inheriting current/future periods without limits. Zero is a real limit. Removing an individual period limit creates explicit no limit; Use default deliberately returns it to inheritance.

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

Ledger amounts retain their signs. Overview and Budgets display net spending as a positive amount unless refunds exceed expenses. Label aggregate remaining values as applying to budgeted spending categories. Do not use cash balance, owed, saved, or safe to spend for person or group or spending limits.

Use sentence case and direct action names: Add transaction, Import CSV, Set limit, Invite, Accept, Decline, Leave sheet. Product messages describe the user-visible problem and next action. They do not expose database jargon, fingerprints, or server stack details.

## Loading, errors, and accessibility

Initial page loads use skeletons matching the final layout, without fabricated amounts. Changing the month marks the money panels busy until all displayed values belong to the new month. Do not briefly relabel the old month's totals as the new month. Prefer pessimistic money mutations: show confirmation after the server accepts the operation and refresh affected totals together.

Field errors are associated with their controls. Async success and error messages are announced to assistive technology. Tables have headers, dialogs have titles, nav marks the current page, and icon-only buttons have accessible names. All functions work by keyboard, and tap targets are at least 44px. Text and control states must meet WCAG 2.2 AA contrast requirements; verify the rendered component, not only the token palette. Honor reduced-motion preferences and avoid layout-shifting animations. Keep text and numeric values available without hover.

## Reference fixture

The visual reference uses Family, USD, October 2026, and person or group labels Ethan, Parents, and Me. These are fixture values, not production defaults. It represents an owner with one accepted member.

| Transaction | Signed amount | Spending category | Responsible for |
| --- | --- | --- | --- |
| Market purchase | -$100.00 | Groceries | Ethan $60.00, Parents $40.00 |
| Market refund | +$20.00 | Groceries | Ethan $20.00 |
| Electricity | -$120.00 | Utilities | Ethan $70.00, Parents $50.00 |
| Lunch | -$24.50 | Dining | Ethan $24.50 |
| Fuel | -$35.00 | Transport | Ethan $35.00 |
| Unreviewed purchase | -$18.50 | Uncategorized | Me $18.50 |
| Card payment | -$100.00 | Excluded transfer | Excluded |
| Paycheck | +$2,000.00 | Excluded income | Excluded |

Net spending is $278.00. Responsibility is Ethan $169.50, Parents $90.00, and Me $18.50. Groceries, Utilities, Dining, and Transport limits are $150.00, $100.00, $100.00, and $60.00. Budgeted spending is $259.50 against $410.00 in limits, leaving $150.50. Utilities is $20.00 overspent. Uncategorized spending is $18.50 and has no limit.

## Handoff acceptance

### Implemented Overview

Overview shows net spending, remaining for budgeted spending categories with its spending and limit totals, Uncategorized spending, spending category budget progress, spending by group, and the five most recent transactions in the selected month. Its budget and ledger reads share one database snapshot. Unbudgeted spending contributes to net spending without inventing a remaining limit. Refund-only months retain negative net spending and group totals; progress starts at zero. Overspent progress caps at the track width while the text shows the complete amount. Archived labels remain visible in historical records.

The spending category and person or group panels use the reference's desktop 2:1 layout and stack on smaller screens. Recent transactions use the shared desktop table, phone cards, and guarded transaction editor. View all retains the month; Review uncategorized opens the ledger with that month and a visible, removable spending category filter. Add transaction retains month context and uses the normal entry defaults. First-use, empty-month, no-limits, skeleton, failed-load Retry, and revoked-access states display actual data without fixture defaults. The remaining summary says No limits set when no limits exist, including months that have spending. An explicit zero limit remains a real limit.

### Implemented monthly budgets

Budgets implements monthly spending category limits, three summary panels, desktop rows and phone cards, and a separate Spending categories without limits section. Set limit and Edit limit open the shared guarded dialog with exact currency amounts. Removing a limit confirms that transactions remain. An explicit zero remains a budget; missing and removed limits say No limit. Remaining calculations retain negative values; rows show the overspent magnitude and the word overspent in the danger treatment. Income, transfers, and deleted transactions are excluded by the same spending calculation that supplies the spending API.

Month changes reload the money panels together without displaying the previous month's values. Failed loads offer Retry. Failed saves preserve the entered amount; conflicting saves and removals require Reload latest with explicit confirmation before discarding local input. Archived spending categories with limits or net spending stay visible in historical reports. Existing archived limits remain editable and removable, while setting a new archived-spending category limit requires restoring the spending category in Settings. Recurring defaults apply where a month inherits its default. Explicit monthly overrides, including no limit, remain distinct. Unused budget amounts do not roll over.

### Implemented manual ledger

Transactions now implements the ledger and transaction editor contract above: six desktop columns, phone cards, 50-row pagination, explicit phone filters, exact signed currency amounts, split entry, conflict reload, deletion confirmation, and transaction account creation when no active transaction account exists. The ledger initially filters to the selected month; Clear filters includes all dates. An empty sheet says No transactions yet, while a sheet with records outside the selected month says No transactions this month. The selected month remains in navigation URLs when opening the editor from Overview or Budgets, and new entries use the browser's current calendar date. Add transaction is available in the shared shell and the Transactions toolbar.

Overview and Budgets now implement their summaries and monthly limits as described above. Sharing implements the owner and member flows described in Sharing and incoming invitations. Archived organization items remain visible in filters and as retained choices in historical transactions; newly added allocations offer active items only.

### Implemented import workflow

Import CSV implements the four stages above with remembered transaction account/format preferences, optional reusable formats, collapsed locked source settings, source samples, and parsed examples. Review resumes persisted server data through its batch URL. Default to 50 rows with 25/50/100 choices, synchronized range/page navigation above and below the list, and page-size changes retaining the previous first row. Page changes scroll and focus the top navigation; mutations and uncertain outcomes disable paging. The parent owns complete raw session drafts by stable row ID across drawer unmounts, paging, and page-size changes. Explain Changes are kept until you leave or refresh this page even before editing. Show Pending edits beside edited rows and distinguish them from imported results. Display whole-file counts and an unresolved-row summary with direct Review row actions as well as errors beside controls. Refresh/reopening restores saved server review, with no browser draft persistence or automatic server saving. Choosing another file, links, and Share navigation ask before discarding pending edits; browser unload uses its standard prompt. Loading latest preserves drafts, marks changed baselines, and requires explicit Use latest values or Keep my edits against latest. A changed possible match resets Import action to pending for another choice. Final Import X transactions submits every pending edit together. Failed responses preserve raw values. Newly possible corrected matches return current normalized source/candidates for re-review without persisting proposed edits. Unknown outcomes require batch-status verification before retry. Valid untouched rows/corrections remain importable without individual review; unresolved fields/decisions have visible guidance, and pending valid edits never block final submission merely because they exist.

Original imported fields and current matching transaction fields appear separately, including deleted matches. Candidate details disclose the first 20 of the full candidate count and show occurrence counts. Definite duplicates are inspectable and skipped. A stale preview highlights changed source rows, preserves proposals, and identifies decisions requiring another choice. CSV import format and row conflicts preserve local inputs until the user explicitly reloads.

Confirmation shows Importing transactions. A network failure triggers batch-status verification; unresolved status exposes Check import status and blocks another confirmation. Results report added, skipped, and excluded counts. View imported transactions opens the ledger without a month restriction and with a visible removable import filter; Clear filters removes that filter too. This implementation follows the existing tokens and reference components without material visual changes. The household confirmed its first export's Transaction Date spending date, ISO dates, positive debit/credit magnitudes, blank unused cells, period decimals, and lack of a stable source ID. First-time mapping remains explicit; compatibility checks use synthetic data and additional export formats remain unconfirmed.

### Shared shell, settings, and access

The shared responsive shell implements sheet selection and creation, role and currency display, period navigation, and the working Overview, Transactions, Amount owed, Budgets, Import, and Settings screens. Settings includes owner sheet rename/delete, transaction account/spending category/person or group organization, recurring default budgets, budget cycle configuration, and display-name editing. Page navigation uses the remembered authorized sheet. Switching sheets opens Overview in the current cycle and closes editors. Use the navigation and loading contract above for persistent shell behavior.

Global Invites is available even without sheets, shows the real pending count after loading, and offers accept/decline and Open sheet. The no-sheet welcome page also contains incoming invitations. Owner-only Share provides an explicit search with a two-character minimum, username disambiguation, pending invitation feedback, and a link to People settings. The complete MVP sharing, spending, settings, and summary contracts above remain unchanged. Auth and sheet creation reuse shared controls; modal creation retains entries through Keep editing, asks before dirty dismissal, and blocks dismissal during submission. Phone Menu uses the same native modal dialog behavior. Settings uses actual role, currency, organization, and accepted-user records. Its labeled panels use setting rows with actions that stack on phones. Organization editors use the same guarded native dialogs. People shows accepted members and, for owners, pending invitations. Owner revoke/remove and member leave actions require confirmation. Known sheet-access failures clear financial screens and open dialogs, remove the remembered selection, refresh route data, and offer a valid sheet or creation path. Accepted invitations update the switcher without requiring an existing personal sheet. Names are trimmed, limited to 80 characters, and unique per entity kind within each sheet, including archived names, using Unicode normalization and case-insensitive comparison. Subsequent screens reuse these primitives.

A UI handoff includes the implemented screens, any intentional deviations, and screenshots of the actual app at 1440px and 390px widths. Check 320px for page overflow and keyboard navigation at desktop width. The HTML reference is evidence of intended appearance, not proof that the app works.

Verify these behaviors on the implemented screens:

- Navigation order, active sheet, current page, owner/member controls, and global incoming invitations match this spec.
- Summary values, ledger rows, budgets, and person or group agree with the fixture and implementation-plan calculations.
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

## Export sheet

Settings places an Export sheet panel directly after the Sheet panel, available to owners and accepted members. Reuse Panel, Selector, Field, Notice, Button and existing responsive spacing. The panel explains the workbook tabs and date semantics before the download: transaction and repayment dates are filtered, Budgets uses full overlapping periods, and debt balances/source history stay all-time. Explain exact text money columns and blank numeric cells for amounts beyond Excel precision.

Export scope defaults to All data. Choosing Date range reveals required inclusive Start date and End date fields. Download Excel workbook validates real YYYY-MM-DD dates and their order, then disables the scope/date inputs and shows Preparing workbook while pending. Prevent duplicate submissions. A validation or server/network failure appears in an error Notice and retains the choices for retry. Session/access errors follow shared sheet-access navigation. Success downloads homebooks-export.xlsx and displays guidance to open in Excel or import into Google Sheets. The Export info tab lists dataset scopes and row counts, including empty datasets that have no tab. There is no data-edit conflict because export reads one authorized snapshot and changes no source records.

At 1440px the panel follows the existing Settings content width. At 390px and 320px the controls follow shared full-width form styling and dates stack without horizontal overflow. Keyboard users can select scope, fill both dates and invoke download; pending status and Notice feedback remain accessible through existing components.

Export sheet also explains that archived whole-expense repayment dates/comments remain contextual and never add to repayment totals. The Legacy repayment metadata workbook tab is present only when archived metadata exists, retains untracked/deleted/out-of-range transaction context with stable IDs and explicit current/included flags, and is independent of the selected date range.

The protected default person or group for new manual and imported transactions is Me. It is a shared sheet label, not a viewer-relative identity. Existing Unassigned allocations stay attached to an archived historical group after migration; historical labels and spending totals do not change.


## Concise copy and contextual help

Use **Responsible for** on expense allocations, ledger columns and filters, import controls, and workbook split headers. Use **People and groups** for the Settings collection. This describes the people responsible for the spending, regardless of the account charged or who physically paid. Keep **People** for sheet access. Internal bucket IDs and repayment rules are unchanged. Me is the protected sheet default; assigning a person or group does not enable repayment tracking.

Remove page subtitles and routine descriptions that repeat headings or actions. Keep names and primary actions as text. Keep validation, permission errors, unsaved edits, uncertain outcomes, and destructive or financial consequences immediately visible. Retain actual CSV examples beside mapping controls, and allocation totals beside divided expenses.

Use shared contextual Help only for unfamiliar concepts: responsibility, net spending, budget/default rules, export scope, CSV mapping/review, bulk eligibility, repayment tracking, and upcoming-payment planning. Render a native details disclosure with a 44px summary target, an accessible “Help: [topic]” name, and visible keyboard focus. Activate with click, touch, Enter, or Space; activate again to collapse. Expanded text remains in normal document flow and never overlays controls. It starts collapsed, requires no hover, and is separate from actionable warnings. Do not add a help icon where text can simply be deleted.
