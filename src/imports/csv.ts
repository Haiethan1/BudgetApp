import { z } from "zod";
import { currencyPrecision, dateSchema, parseMoney } from "../ledger/input";
import { SheetError } from "../sheets/service";

export const importLimits = { fileBytes: 2 * 1024 * 1024, rows: 5000, columns: 100, cellCharacters: 10000 };
const column = z.string().trim().min(1).max(200);
export const mappingSchema = z.object({
  version: z.literal(1), profile: z.string().trim().min(1).max(80),
  date: column, payee: column, sourceId: column.optional(),
  dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]),
  decimalSeparator: z.enum([".", ","]),
  money: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("signed"), amount: column, outflowSign: z.enum(["negative", "positive"]) }),
    z.object({ mode: z.literal("debit-credit"), debit: column, credit: column, unused: z.enum(["blank", "blank-or-zero"]) }),
  ]),
}).strict();
export type Mapping = z.infer<typeof mappingSchema>;

// Record positions include the header. Quoted newlines do not create another record.
export function parseCsv(bytes: Uint8Array) {
  if (bytes.byteLength > importLimits.fileBytes) throw new SheetError("Choose a CSV no larger than 2 MiB.", 413);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new SheetError("Save the CSV as UTF-8 and choose it again.", 400); }
  if (text.includes("\0")) throw new SheetError("Choose a text CSV file.", 400);
  const records: string[][] = []; let record: string[] = []; let cell = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  function endCell() {
    record.push(cell); cell = ""; state = "start";
    if (record.length > importLimits.columns) throw new SheetError("CSV files can contain at most 100 columns.", 400);
  }
  function endRecord() {
    endCell(); records.push(record); record = [];
    if (records.length > importLimits.rows + 1) throw new SheetError("Choose a CSV with at most 5,000 data rows.", 413);
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else state = "closed";
      } else cell += char;
    } else if (char === ",") endCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[i + 1] === "\n") i++; endRecord(); }
    else if (char === '"' && state === "start") state = "quoted";
    else if (char === '"' || state === "closed") throw new SheetError(`Malformed CSV quoting in source row ${records.length + 1}.`, 400);
    else { cell += char; state = "plain"; }
    if (cell.length > importLimits.cellCharacters) throw new SheetError("A CSV field exceeds 10,000 characters.", 413);
  }
  if (state === "quoted") throw new SheetError("The CSV has an unfinished quoted field.", 400);
  if (cell.length || record.length || state === "closed") endRecord();
  const headers = records.shift()?.map((value) => value.trim());
  if (!headers?.length || headers.some((value) => !value || value.length > 200) || new Set(headers).size !== headers.length) throw new SheetError("Use unique, nonempty CSV headers of at most 200 characters.", 400);
  if (!records.length) throw new SheetError("The CSV has no data rows.", 400);
  return { headers, records };
}

function normalizeDate(value: string, format: Mapping["dateFormat"]) {
  if (format === "YYYY-MM-DD") return dateSchema.parse(value);
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Use ${format} dates.`);
  const [, first, second, year] = match;
  return dateSchema.parse(`${year}-${format === "MM/DD/YYYY" ? first : second}-${format === "MM/DD/YYYY" ? second : first}`);
}
function decimal(value: string, separator: Mapping["decimalSeparator"]) {
  const pattern = separator === "." ? /^[+-]?\d+(\.\d+)?$/ : /^[+-]?\d+(,\d+)?$/;
  if (!pattern.test(value)) throw new Error("Use digits and the selected decimal separator, without currency symbols or grouping separators.");
  return value.replace(",", ".").replace(/^\+/, "");
}
function exactDecimal(amount: number, currency: string) {
  const precision = currencyPrecision(currency);
  const units = BigInt(amount);
  const digits = (units < 0n ? -units : units).toString().padStart(precision + 1, "0");
  return `${units < 0n ? "-" : ""}${precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits}`;
}
function amountFor(get: (name: string) => string, mapping: Mapping, currency: string) {
  if (mapping.money.mode === "signed") {
    const value = decimal(get(mapping.money.amount), mapping.decimalSeparator);
    const amount = parseMoney(value, currency);
    const signedAmount = mapping.money.outflowSign === "negative" ? amount : -amount;
    return { amount: signedAmount, decimal: exactDecimal(signedAmount, currency) };
  }
  function magnitude(value: string) {
    if (!value) return null;
    const normalized = decimal(value, mapping.decimalSeparator);
    if (normalized.startsWith("-")) throw new Error("Debit and credit must be nonnegative magnitudes.");
    // Zero is only allowed in an unused column under the explicitly chosen policy.
    if (/^0+(\.0+)?$/.test(normalized)) {
      const precision = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 0;
      if ((normalized.split(".")[1]?.length ?? 0) > precision) throw new Error("The unused zero has too many decimal places.");
      if (mapping.money.mode === "debit-credit" && mapping.money.unused === "blank-or-zero") return null;
      throw new Error("Leave the unused debit or credit column blank.");
    }
    const amount = parseMoney(normalized, currency);
    return { amount, decimal: exactDecimal(amount, currency) };
  }
  const debit = magnitude(get(mapping.money.debit)); const credit = magnitude(get(mapping.money.credit));
  if (Boolean(debit) === Boolean(credit)) throw new Error("Enter exactly one nonzero debit or credit.");
  if (debit) return { amount: -debit.amount, decimal: `-${debit.decimal}` };
  if (credit) return credit;
  throw new Error("Enter a nonzero amount.");
}
export function normalizeCsv(csv: ReturnType<typeof parseCsv>, mapping: Mapping, currency: string, defaults: { accountId: string; categoryId: string; bucketId: string }) {
  const selected = [mapping.date, mapping.payee, ...(mapping.sourceId ? [mapping.sourceId] : []), ...(mapping.money.mode === "signed" ? [mapping.money.amount] : [mapping.money.debit, mapping.money.credit])];
  if (new Set(selected).size !== selected.length || selected.some((name) => !csv.headers.includes(name))) throw new SheetError("Map each field to a distinct existing CSV column.", 400);
  return csv.records.map((fields, index) => {
    const sourceRow = index + 2;
    if (fields.length !== csv.headers.length) return { status: "invalid" as const, sourceRow, fields, errors: ["The row has a different number of fields than the header."] };
    const get = (name: string) => (fields[csv.headers.indexOf(name)] ?? "").trim();
    const errors: string[] = []; let date = ""; let payee = ""; let money: ReturnType<typeof amountFor> | undefined;
    try { date = normalizeDate(get(mapping.date), mapping.dateFormat); } catch { errors.push(`Date: enter a real ${mapping.dateFormat} date.`); }
    try { payee = z.string().min(1).max(200).parse(get(mapping.payee)); } catch { errors.push("Payee: enter 1 to 200 characters."); }
    try { money = amountFor(get, mapping, currency); } catch (error) { errors.push(`Amount: ${error instanceof z.ZodError ? "enter a nonzero amount within the supported range and precision." : error instanceof Error ? error.message : "check the amount."}`); }
    const sourceId = mapping.sourceId ? get(mapping.sourceId) : null;
    if (sourceId !== null && (!sourceId || sourceId.length > 200)) errors.push("Source ID: mapped IDs must contain 1 to 200 characters.");
    if (errors.length || !money) return { status: "invalid" as const, sourceRow, fields, errors };
    return { status: "valid" as const, sourceRow, fields, source: { date, payee, amount: money.amount, sourceId },
      proposed: { accountId: defaults.accountId, date, payee, kind: money.amount < 0 ? "expense" as const : "refund" as const, amount: money.decimal,
        splits: [{ categoryId: defaults.categoryId, bucketId: defaults.bucketId, amount: money.decimal }] },
      needsKindReview: true,
    };
  });
}
