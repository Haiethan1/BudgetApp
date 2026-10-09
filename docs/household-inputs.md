# Household implementation inputs

These decisions come from the household's October 2, October 4, and October 9, 2026 instructions. They refine the MVP without adding features. Production installation and recovery still require checks on the actual machines.

| Input | Decision | Status |
| --- | --- | --- |
| Access | LAN only for the MVP; private Tailscale access may follow later | Confirmed by the household |
| Production host | UGREEN NAS running UgreenOS/Linux Docker | Confirmed October 9; actual installation unverified |
| Browser origin | Configurable `http://NAS-LAN-IP:3000` initially; HTTPS optional on the LAN | Template agreed; actual NAS address remains to be recorded |
| Recovery operator | Ethan | Confirmed October 9 |
| Off-host recovery | Encrypted archives pulled from the NAS to Ethan's Windows PC | Confirmed October 9; actual transfer and restore unverified |
| First CSV source | Capital One headers and conventions below | Confirmed by the household on October 4, 2026 |
| Initial sheet currency | USD | Confirmed by the household |
| Attribution labels | Ethan and Parents, editable; protected Unassigned default | Chosen under the household's delegated authority |
| Database and snapshot mounts | `/data` and separate `/backups` named volumes, Compose project `homebooks` | Defaults accepted; actual NAS storage location remains to be recorded |

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
- Actual NAS LAN address, checkout directory, Docker volume location, and Windows archive directory.
- Installation, verified Windows transfer, and fresh-volume recovery performed by Ethan on those machines.

Keep real statements outside this public repository. Capture an anonymized export only after removing personal descriptions and identifiers; document its actual conventions separately from this synthetic candidate.

The app uses `/data/homebooks.sqlite` and `/backups` inside Docker. The agreed default project produces `homebooks_homebooks-data` and `homebooks_homebooks-backups`. The [deployment guide](deployment-guide.md) and [Windows backup runbook](backup-runbook.md) implement these choices. Agreement on the setup does not prove deployment or recovery; the household-inputs and production acceptance issues remain open until the actual checks are recorded.
