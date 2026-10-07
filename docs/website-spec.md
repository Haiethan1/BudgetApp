# Homebooks website specification

Version 1, October 2, 2026. This is the visual and interaction contract for the MVP described in the [implementation plan](implementation-plan.md). It specifies the intended website, not an existing implementation.

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
| `--color-accent-soft` | `#E7EFE8` | Selected navigation and attribution badges |
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

The sidebar contains Homebooks, a sheet switcher, and this navigation order: Overview, Transactions, Budgets, Import, Settings. Active navigation has a pale green fill, dark green text, and a 3px left indicator. Use one consistent outline icon family at 18 to 20px, with a visible text label. The user menu is at the bottom.

The sheet switcher shows the current sheet and its sharing state. It offers existing sheets and Create sheet. Create sheet asks for name and currency, explains that currency cannot change after transactions exist, and starts with the current user as owner. Switching sheets resets sheet-scoped filters and open editors and routes to that sheet's Overview. Switching away with a dirty editor triggers the unsaved-changes dialog.

The top bar identifies the current sheet, shows the currency, and contains global Invites with a pending count. Owners also see Share. Add transaction is the primary action on money pages. On phones, the bar contains Menu, the sheet name, and Invites. The page heading row contains Add transaction and owner-only Share with visible labels. Menu opens the sheet switcher and page navigation. There is no bottom navigation or floating button overlapping content.

Each page starts with its title, a short description when useful, and page controls. Month-sensitive pages show a month picker at the right on desktop and below the heading on phones. The month is written October 2026, not an ambiguous numeric date. Overview and Budgets share the selected month for the active sheet. Transactions starts with that month but can change to another range. Import shows its own source dates.

## Shared components

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

Dialogs trap focus, restore focus to their trigger, and support Escape when idle. Closing a dirty editor asks Discard changes? with Keep editing and Discard changes. During a commit, prevent accidental dismissal and show the pending operation. Do not nest dialogs. Open member management in Settings after closing Share.

## Overview

The page heading is Overview, followed by Track this sheet's spending for the selected month. Its sections appear in this order:

1. Three summary panels: Net spending, Remaining in budgeted categories, and Uncategorized spending. On desktop they share one row. The remaining panel also shows budgeted spending and total limits. Uncategorized links to the filtered ledger.
2. Category budgets on the left and Expense attribution on the right, in a roughly 2:1 desktop grid. On smaller screens the panels stack in that order.
3. Recent transactions, newest effective date first, with View all linking to Transactions.

Budget rows show category, net spent, limit, remaining or overspent, and a horizontal progress bar. The bar caps visually at its track width, but the displayed numbers retain overspending. A red label says $20.00 overspent. If refunds produce negative net spending, the bar starts at zero and text still displays the negative amount.

Attribution lists stable bucket names and their net expense totals. It includes Unassigned when nonzero. It does not label a bucket as owed, balance, or available cash. No pie chart is required.

If the sheet has no transactions, retain the heading and show No transactions yet with Add transaction and a secondary Import CSV action. Do not present missing budget limits as zero remaining. Show No monthly limits set with Set budgets. When the selected month has no transactions, show $0.00 spending with No transactions this month, rather than the first-use message.

## Transactions

The heading is Transactions. The toolbar contains a search field and filters for effective date range, financial account, kind, category, and bucket. The search label is Search payees. Show active filters and Clear filters. Phones show search and a Filters button; the filter form opens in a dialog and applies explicitly.

Desktop columns are Date, Payee, Account, Category, Attribution, and Amount. Rows are at least 56px high. Kind appears below the payee or as a small badge. A split row displays Split across 2 categories or Split across 2 buckets as applicable, with full details in its editor. Columns can show a single value when all splits share it. Row activation opens the editor; the payee also provides a keyboard-operable Edit action. Sorting initially uses newest date, then stable record order. Pagination shows a row range with Previous and Next; start with 50 rows per page.

Phones render transaction cards instead of a squeezed six-column table. Each card shows payee and signed amount, then effective date, account, kind, category, and attribution. Long payees wrap. The card has a labeled Edit action. Transfers remain visible and say Excluded from spending.

The editor contains Kind, Date, Account, Payee, Amount, and expense or refund allocation fields. Amount is a positive magnitude in the form. Kind determines its ledger sign; Transfer additionally requires Money in or Money out. Show the currency beside the amount. Expense and Refund offer Category and Attribution and a Split transaction action.

Split mode replaces the single allocation with rows containing amount, category, and attribution. Add split and Remove split are labeled actions. A footer shows the entered total and the remaining amount to allocate. Save is unavailable until allocations equal the parent amount, with visible explanatory text. A normal transaction still has one allocation. Income and Transfer omit allocation controls and explain that they do not affect spending budgets.

New manual transactions default to Expense, the browser's current date without timezone conversion, Uncategorized, and Unassigned. Existing records preserve their values. Account is preselected only when there is exactly one active account; otherwise require a choice. If no active account exists, replace the form with an Add financial account step, then return to the editor.

Deletion is available in the existing transaction editor and asks Delete this transaction? It explains that spending totals change and future imports will still recognize its source. It does not promise a full undo workflow. On a stale edit, preserve the unsaved values, show Someone updated this transaction, and offer Reload latest after confirmation that the local changes will be discarded.

No matching transactions shows Clear filters. A load failure shows Retry in the page panel. An authorization failure removes visible sheet data and routes to the sheet-access state.

## Budgets

The heading is Budgets with the selected month and Monthly category spending limits. Summary values show Total limits, Net spent in budgeted categories, and Remaining in budgeted categories.

The desktop table contains Category, Monthly limit, Net spent, and Remaining. Phone cards retain the same four values. Rows offer Set limit or Edit limit. Editing opens a small dialog with category, selected month, currency amount, Save limit, and Cancel. No limits are copied automatically from another month. Removing a limit confirms that the month's transactions remain.

Show unbudgeted active categories in a separate Categories without limits section, including their net spending and Set limit. A zero-dollar limit is a real limit and can be overspent. A missing limit says No limit. Overspending uses red text and the word overspent, without relying on the sign alone.

The screen has no envelope funding, available-to-assign balance, rollover controls, or bucket budgets. All attribution buckets count toward the category's spending.

## Import

The page heading is Import CSV. A labeled step indicator shows 1. File and account, 2. Mapping, 3. Review, and 4. Result. It is a progress indicator, not a way to skip required validation.

File and account selects the target financial account and file. A bordered drop area also has Choose CSV file. File selection must work without drag-and-drop. Show the filename, file size, and selected account. State the actual configured size and row limits near the chooser. Existing source profiles are selectable; first-time mapping remains explicit.

Mapping shows the source headers with a small sample of original values, then controls for date, payee, amount or debit and credit, optional source ID, date format, decimal format, and sign convention. Parsed samples appear beside source samples. Ambiguous values require a choice. Continue to review validates the mapping; it does not commit money records.

Review starts with the account and counts for New, Already imported, Needs review, Invalid, and Excluded. Rows show source position, date, payee, kind, amount, allocation, status, and any keep-or-skip decision. Needs review shows why a row may match, and lets users inspect the existing transaction. Identical new rows remain separately visible.

Users can edit proposed kinds and allocations before confirmation. Invalid rows show their error and Correct or Exclude. Commit stays unavailable while required decisions or invalid rows remain unresolved. The action names the number being added, such as Import 8 transactions, and previews any excluded or skipped counts. A zero-new-row review says Nothing new to import and offers Done.

On phones, preview rows are expandable cards with every source field and decision available. Column mapping stacks. Commit uses a footer with the number of rows and enough safe-area spacing. Never hide a duplicate or validation decision to fit the screen.

Pending confirmation says Importing transactions. A stale preview says Data changed since this preview and returns the user to reviewed rows with the changed decisions identified. A failed confirmation leaves the review in place and offers Retry. If the outcome cannot yet be determined after a network failure, verify batch status before claiming failure or asking for another commit.

Result reports added, skipped, and excluded counts and offers View imported transactions. A repeated file clearly says This file was already imported. No bank-connect buttons, OFX/QFX chooser, or auto-categorization editor appear in this MVP.

## Settings

Use sections in this order: Sheet, Financial accounts, Categories, Attribution buckets, People, and Your profile. Phones stack sections. Desktop uses a vertical page with labeled panels; avoid a second sidebar. Sheet settings refer to the selected sheet. Profile changes apply to the signed-in user across sheets.

Owner-only Sheet controls rename and delete the sheet. Currency is read-only after creation. Sheet deletion requires typing its name and explains that it removes this sheet's records for everyone. Membership removal uses a confirmation naming the affected person. Members see their role and Leave sheet instead of owner controls.

Owner and members can add, rename, and archive financial accounts, categories, and buckets. Account forms ask for name and source type, not credentials or balances. Protected defaults cannot be renamed or archived. Archived items retain historical display names and are unavailable for new allocations. The UI can restore an archived label without deleting its history.

People shows the owner, accepted members, and pending invitations. Owners can invite and revoke. Members can see who shares the sheet and leave. Profile allows display-name changes and sign-out; it shows username and email without inventing an account-recovery email flow.

An instance admin additionally sees a Backup status panel with last success, next scheduled attempt, and a failure message if needed. It explains that recovery uses the documented host commands and links to local recovery instructions when implemented. It has no browser Download backup or Restore button. Non-admins do not see instance backup status.

## Sharing and incoming invitations

Share opens with Invite someone to Family and the explanation Members can view and edit the whole sheet after they accept. Search results show display name and unique username, not private financial information. Every result has an Invite action. Sending changes its state to Invitation sent and prevents sending the same pending invite again.

Empty search says No matching people. Search failure is distinct from no matches and offers Retry. Search debounce and minimum query length can follow the selected implementation, but the UI must describe any minimum and must not show a server-wide user directory before a search.

Global Invites opens an incoming-invitations dialog. Each item shows inviter, sheet name, and Accept and Decline. There are no account names, balances, or spending previews before acceptance. Acceptance adds the sheet to the switcher and offers Open sheet. Declining or a revoked invite removes it from pending items and explains the result.

With no accessible sheets, show a welcome page containing Create sheet and any incoming invitations. Users can accept invitations without creating a Personal sheet first. If access to the current sheet is revoked or the sheet is deleted, clear its rendered financial data and show This sheet is no longer available with Choose another sheet or Create sheet.

## Sign-in and registration

Unauthenticated screens use the canvas color with a centered white panel up to 420px wide, Homebooks above it, and 24px padding. Phones use a full-width panel with 16px outer margins. There is no authenticated navigation.

Sign-in has Email or username, Password, Show password, and Sign in. Registration has Display name, Username, Email, Password, and Create account, and appears only when registration is enabled. Password rules come from actual auth configuration and appear before submission. A disabled-registration state explains Ask your household admin to enable registration. Password help explains the admin recovery process without offering a nonfunctional reset-email link.

First-instance setup includes the one-time setup token field and explains that this account becomes instance admin. Setup is unavailable after initialization. Errors preserve entered identity fields without echoing passwords or setup tokens. Standard password-manager autocomplete and keyboard submission work.

## Dates, money, and copy

Transaction dates use unambiguous local presentation such as Oct 4, 2026. Parsing and storage retain date-only values. Amount formatting follows the sheet currency and appropriate minor-unit precision. The visual reference uses USD and US-English examples, not a requirement to hard-code two decimals for every currency.

Ledger amounts retain their signs. Overview and Budgets display net spending as a positive amount unless refunds exceed expenses. Label aggregate remaining values as applying to budgeted categories. Do not use cash balance, owed, saved, or safe to spend for attribution or spending limits.

Use sentence case and direct action names: Add transaction, Import CSV, Set limit, Invite, Accept, Decline, Leave sheet. Product messages describe the user-visible problem and next action. They do not expose database jargon, fingerprints, or server stack details.

## Loading, errors, and accessibility

Initial page loads use skeletons matching the final layout, without fabricated amounts. Changing the month marks the money panels busy until all displayed values belong to the new month. Do not briefly relabel the old month's totals as the new month. Prefer pessimistic money mutations: show confirmation after the server accepts the operation and refresh affected totals together.

Field errors are associated with their controls. Async success and error messages are announced to assistive technology. Tables have headers, dialogs have titles, nav marks the current page, and icon-only buttons have accessible names. All functions work by keyboard, and tap targets are at least 44px. Text and control states must meet WCAG 2.2 AA contrast requirements; verify the rendered component, not only the token palette. Honor reduced-motion preferences and avoid layout-shifting animations. Keep text and numeric values available without hover.

## Reference fixture

The visual reference uses Family, USD, October 2026, and attribution labels Ethan, Parents, and Unassigned. These are fixture values, not production defaults. It represents an owner with one accepted member.

| Transaction | Signed amount | Category | Attribution |
| --- | --- | --- | --- |
| Market purchase | -$100.00 | Groceries | Ethan $60.00, Parents $40.00 |
| Market refund | +$20.00 | Groceries | Ethan $20.00 |
| Electricity | -$120.00 | Utilities | Ethan $70.00, Parents $50.00 |
| Lunch | -$24.50 | Dining | Ethan $24.50 |
| Fuel | -$35.00 | Transport | Ethan $35.00 |
| Unreviewed purchase | -$18.50 | Uncategorized | Unassigned $18.50 |
| Card payment | -$100.00 | Excluded transfer | Excluded |
| Paycheck | +$2,000.00 | Excluded income | Excluded |

Net spending is $278.00. Attribution is Ethan $169.50, Parents $90.00, and Unassigned $18.50. Groceries, Utilities, Dining, and Transport limits are $150.00, $100.00, $100.00, and $60.00. Budgeted spending is $259.50 against $410.00 in limits, leaving $150.50. Utilities is $20.00 overspent. Uncategorized spending is $18.50 and has no limit.

## Handoff acceptance

### Implemented monthly budgets

Budgets implements monthly category limits, three summary panels, desktop rows and phone cards, and a separate Categories without limits section. Set limit and Edit limit open the shared guarded dialog with exact currency amounts. Removing a limit confirms that transactions remain. An explicit zero remains a budget; missing and removed limits say No limit. Remaining calculations retain negative values; rows show the overspent magnitude and the word overspent in the danger treatment. Income, transfers, and deleted transactions are excluded by the same spending calculation that supplies the spending API.

Month changes reload the money panels together without displaying the previous month's values. Failed loads offer Retry. Failed saves preserve the entered amount; conflicting saves and removals require Reload latest with explicit confirmation before discarding local input. Archived categories with limits or net spending stay visible in historical reports. Existing archived limits remain editable and removable, while setting a new archived-category limit requires restoring the category in Settings. Limits are not copied or rolled over. Overview summaries remain unavailable until the Overview issue is implemented.

### Phase 1 manual ledger

Transactions now implements the ledger and transaction editor contract above: six desktop columns, phone cards, 50-row pagination, explicit phone filters, exact signed currency amounts, split entry, conflict reload, deletion confirmation, and account creation when no active account exists. The ledger initially filters to the selected month; Clear filters includes all dates. An empty sheet says No transactions yet, while a sheet with records outside the selected month says No transactions this month. The selected month remains in navigation URLs when opening the editor from Overview or Budgets, and new entries use the browser's current calendar date. Add transaction is available in the shared shell and the Transactions toolbar.

Overview and Budgets continue to explain that summaries and monthly limits are unavailable until their implementation issues. Overview does not claim the sheet has no transactions when its ledger already contains records. Sharing retains its documented unavailable state. Archived organization items remain visible in filters and as retained choices in historical transactions; newly added allocations offer active items only.

### Implemented import workflow

Import CSV implements the four stages above with an explicit account and file chooser, saved profile versions, blank first-time mapping choices, and source samples beside validated parsed samples. A batch URL resumes a persisted review. Review uses the reference's five desktop columns and expandable phone cards. It pages 50 source rows at a time to keep 5,000-row files usable; counts describe the complete file. Row correction, kind acknowledgment, duplicate choices, and exact split edits use the shared guarded transaction drawer.

Original imported fields and current matching transaction fields appear separately, including deleted matches. Candidate details disclose the first 20 of the full candidate count and show occurrence counts. Definite duplicates are inspectable and skipped. A stale preview highlights changed source rows, preserves proposals, and identifies decisions requiring another choice. Profile and row conflicts preserve local inputs until the user explicitly reloads.

Confirmation shows Importing transactions. A network failure triggers batch-status verification; unresolved status exposes Check import status and blocks another confirmation. Results report added, skipped, and excluded counts. View imported transactions opens the ledger without a month restriction and with a visible removable import filter; Clear filters removes that filter too. This implementation follows the existing tokens and reference components without material visual changes. The household confirmed its first export's Transaction Date spending date, ISO dates, positive debit/credit magnitudes, blank unused cells, period decimals, and lack of a stable source ID. First-time mapping remains explicit; compatibility checks use synthetic data and additional export formats remain unconfirmed.

### Phase 0 foundation exception

The phase 0 app implements the shared responsive shell, real sheet selection/creation, role and currency display, month selection, and foundation Settings. Issue #9 extends Settings with owner sheet rename/delete, account/category/bucket organization, and display-name editing. Transactions, Budgets, and Import routes show explicit unavailable/empty states until their later implementation issues are complete. They do not display fixture amounts, charts, or actions that pretend to save records. Overview and Budgets preserve the chosen month in the active sheet's navigation URL; switching sheets opens Overview with the current month and closes editors.

Global Invites remains available even without sheets, and owner-only Share opens a dialog explaining that sharing is unavailable until its implementation issue. Neither claims an empty inbox or invented pending count. The complete MVP sharing, spending, settings, and summary contracts above remain unchanged. Auth and sheet creation reuse shared controls; modal creation retains entries through Keep editing, asks before dirty dismissal, and blocks dismissal during submission. Phone Menu uses the same native modal dialog behavior. Settings uses actual role, currency, organization, and accepted-user records. Its labeled panels use setting rows with actions that stack on phones. Organization editors use the same guarded native dialogs. Sharing and leaving remain unavailable until the sharing issue. Names are trimmed, limited to 80 characters, and unique per entity kind within each sheet, including archived names, using Unicode normalization and case-insensitive comparison. Subsequent screens reuse these primitives.

A UI handoff includes the implemented screens, any intentional deviations, and screenshots of the actual app at 1440px and 390px widths. Check 320px for page overflow and keyboard navigation at desktop width. The HTML reference is evidence of intended appearance, not proof that the app works.

Verify these behaviors on the implemented screens:

- Navigation order, active sheet, current page, owner/member controls, and global incoming invitations match this spec.
- Summary values, ledger rows, budgets, and attribution agree with the fixture and implementation-plan calculations.
- Long payees, large amounts, split rows, refunds, zero limits, missing limits, and overspending remain readable.
- Each implemented screen has empty, loading, failed-load, validation, and pending-save states where applicable.
- Transaction and budget conflict messages preserve unsaved inputs. Import ambiguity and uncertain network outcomes remain actionable.
- Phone layouts retain all form fields, duplicate decisions, signed amounts, and labeled actions.
- Shared components use the specified tokens. Focus, contrast, dialog behavior, and reduced motion are checked in the real app.
- Screens do not introduce deferred features or fake success states to fill empty space.
