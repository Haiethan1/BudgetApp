# Household implementation inputs

These decisions come from the household's October 2, 2026 instructions. They refine the MVP without adding features. Foundation work can proceed; household import compatibility and release deployment checks require the remaining answers below.

| Input | Decision | Status |
| --- | --- | --- |
| Access | Private network | Confirmed by the household |
| First CSV source | Primarily Capital One exports | Confirmed by the household; exact export profile unknown |
| Initial sheet currency | USD | Confirmed by the household |
| Attribution labels | Ethan and Parents, editable; protected Unassigned default | Chosen under the household's delegated authority |
| Database and snapshot mounts | `/data` and separate `/backups` named volumes | Development defaults implemented by the scaffold; production host and backup target unknown |

Ethan and Parents are proposed editable labels for the household's sheets, not production seed data. Unassigned is the protected default required by the implementation plan. Sheet creation and later settings should follow their own issues; this document does not authorize importing fixture transactions into production.

## CSV candidate and synthetic fixture

[capital-one-candidate.csv](fixtures/capital-one-candidate.csv) is entirely synthetic. It contains invented purchase, refund, and payment examples, with the `Card No.` cells left blank. It contains no real statement, account identifier, or card value.

The candidate headers are `Transaction Date`, `Posted Date`, `Card No.`, `Description`, `Category`, `Debit`, and `Credit`. This is an UNCONFIRMED illustrative profile, not evidence of the household's actual Capital One headers or compatibility. The actual account type is also unconfirmed.

For this fixture only, dates use `YYYY-MM-DD`, debit and credit columns contain nonnegative decimal USD magnitudes with a period separator and two minor-unit digits, and an unused amount column is blank. Purchases use Debit, refunds use Credit, and the payment example is a transfer excluded from spending. The Description values explain these invented cases; actual transfer classification must be reviewed during import. Source Category text does not establish Homebooks category assignments.

There is no source transaction ID column in this candidate. Source-ID availability in the household export remains unknown. The implementation must not treat the description, card field, date, or row number as a stable source ID. Without confirmed source IDs, duplicate review follows the plan's occurrence-count and overlap rules.

Both transaction and posted dates are present to expose the effective-date choice. The household must confirm which date should determine spending month. Later import mapping must require that choice rather than selecting it silently. Actual date format, amount conventions, signs, decimal separator, and blank/zero behavior must likewise be confirmed from an anonymized household export before declaring a supported profile.

## Answers needed before profile and release checks

On October 4, 2026, the household supplied an indicative single-row example using the candidate headers, ISO transaction and posted dates, a description, and a debit magnitude with a blank credit. This supports implementing explicit mapping for those conventions. The wording "something like this" does not confirm all export cases, source-ID availability, zero behavior, or which date should determine spending. The example's card identifier and purchase details are not copied into repository fixtures.

- Exact exported headers and required account types, such as credit card or checking.
- Actual date and amount conventions, effective transaction-versus-posted date, and source transaction ID availability.
- Intended production host and private-network browser origin.
- Persistent host storage paths, off-host backup destination, and the operator responsible for recovery.

Keep real statements outside this public repository. Capture an anonymized export only after removing personal descriptions and identifiers; document its actual conventions separately from this synthetic candidate.

The running scaffold uses `/data/homebooks.sqlite` and `/backups` inside Docker. Those mounts do not specify the production machine or provide off-host recovery. The household-inputs issue remains incomplete until the unconfirmed import and deployment inputs are resolved.
