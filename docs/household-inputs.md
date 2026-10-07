# Household implementation inputs

These decisions come from the household's October 2 and October 4, 2026 instructions. They refine the MVP without adding features. The first CSV export conventions are agreed; other exports and production deployment checks require the remaining answers below.

| Input | Decision | Status |
| --- | --- | --- |
| Access | Private network | Confirmed by the household |
| First CSV source | Capital One headers and conventions below | Confirmed by the household on October 4, 2026 |
| Initial sheet currency | USD | Confirmed by the household |
| Attribution labels | Ethan and Parents, editable; protected Unassigned default | Chosen under the household's delegated authority |
| Database and snapshot mounts | `/data` and separate `/backups` named volumes | Development defaults implemented by the scaffold; production host and backup target unknown |

Ethan and Parents are proposed editable labels for the household's sheets, not production seed data. Unassigned is the protected default required by the implementation plan. Sheet creation and later settings should follow their own issues; this document does not authorize importing fixture transactions into production.

## CSV candidate and synthetic fixture

[capital-one-candidate.csv](fixtures/capital-one-candidate.csv) is entirely synthetic. It contains invented purchase, refund, and payment examples, with the `Card No.` cells left blank. It contains no real statement, account identifier, or card value.

The first export headers are `Transaction Date`, `Posted Date`, `Card No.`, `Description`, `Category`, `Debit`, and `Credit`. The household confirmed these headers and the mapping below on October 4, 2026. The fixture remains synthetic and contains no original card identifier or purchase description. Financial account selection remains explicit.

The fixture uses the agreed first-export conventions: dates use `YYYY-MM-DD`, debit and credit columns contain nonnegative decimal USD magnitudes with a period separator, and an unused amount column is blank. Its invented purchases use Debit, refunds use Credit, and the payment example is a transfer excluded from spending. The Description values explain these invented cases; actual transfer classification must be reviewed during import. Source Category text does not establish Homebooks category assignments.

The first export has no stable source transaction ID. The implementation must not treat the description, card field, date, or row number as a stable source ID. Duplicate review follows the plan's occurrence-count and overlap rules.

The agreed mapping uses `Transaction Date` for spending, `YYYY-MM-DD` dates, and `Description` for payee. Positive `Debit` values are outflows; positive `Credit` values are inflows. The unused amount cell is blank, and decimals use a period. `Posted Date`, `Card No.`, and bank `Category` do not define spending dates, stable identity, or Homebooks allocations. Every imported transaction kind still requires review, including payments that must be transfers. The app does not seed a production profile or select these choices automatically.

## Remaining household and release inputs

The household first supplied an indicative single-row example, then explicitly confirmed its headers, spending date, signs, decimal format, blank unused cells, and lack of a stable source ID. The original card identifier and purchase details are not copied into repository fixtures. Browser compatibility checks use synthetic purchases, refunds, and payments with the agreed mapping.

- Headers, account types, dates, money conventions, and source-ID availability for any additional exports.
- Intended production host and private-network browser origin.
- Persistent host storage paths, off-host backup destination, and the operator responsible for recovery.

Keep real statements outside this public repository. Capture an anonymized export only after removing personal descriptions and identifiers; document its actual conventions separately from this synthetic candidate.

The running scaffold uses `/data/homebooks.sqlite` and `/backups` inside Docker. Those mounts do not specify the production machine or provide off-host recovery. The household-inputs issue remains incomplete until the production deployment inputs are resolved.
