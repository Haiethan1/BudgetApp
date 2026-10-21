import { parseMoney } from "./input";
import { decimalAmount, type Draft } from "./presentation";

export type AllocationDraft = Pick<Draft, "kind" | "amount" | "splitMode" | "splits">;
export type AllocationChange = Pick<Draft, "splitMode" | "splits">;
export type AllocationDefaults = Pick<Draft["splits"][number], "categoryId" | "bucketId">;

export function divideExpense(draft: AllocationDraft, defaults: AllocationDefaults, key: string): AllocationChange {
  if (draft.splits.length > 1) return { splitMode: true, splits: draft.splits };
  const first = draft.splits[0] ?? { ...defaults, key: "initial", amount: "" };
  return { splitMode: true, splits: [{ ...first, amount: "" }, { ...defaults, key, amount: "" }] };
}

function amountError(value: string, currency: string): string | undefined {
  if (!value) return "Enter an amount for this part.";
  try {
    if (parseMoney(value, currency) < 0) return "Enter a positive amount. The transaction kind determines its sign.";
  } catch {
    if (/^-?0+(\.0+)?$/.test(value)) return "Enter an amount greater than zero.";
    return `Enter a valid positive amount with the precision supported by ${currency}.`;
  }
}

export function divisionSummary(draft: AllocationDraft, currency: string) {
  const errors = draft.splits.map((split) => amountError(split.amount, currency));
  let assigned = 0n;
  draft.splits.forEach((split, index) => { if (!errors[index]) assigned += BigInt(parseMoney(split.amount, currency)); });
  try {
    const total = BigInt(parseMoney(draft.amount, currency));
    if (total < 0n) throw new Error("Positive total required");
    const remaining = total - assigned;
    return {
      total: `${decimalAmount(total, currency)} ${currency}`,
      remaining: `${remaining < 0n ? "Over assigned by" : "Still to assign"} ${decimalAmount(remaining, currency)} ${currency}`,
      error: errors.some(Boolean) ? "Complete each part with a valid positive amount. The remaining amount counts valid parts only." : remaining < 0n ? "The parts exceed the original total. Reduce a part or remove it." : remaining > 0n ? "The parts do not yet match the original total. Assign the remaining amount before saving." : "",
      errors,
    };
  } catch {
    return { total: "Enter a valid positive transaction amount above.", remaining: "Still to assign: enter the original total first.", error: "Enter a valid positive original total before saving.", errors };
  }
}
