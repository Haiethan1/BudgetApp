import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpenseAllocationFields, type ExpenseAllocationFieldsProps } from "./expense-allocation-fields";

const props: ExpenseAllocationFieldsProps = {
  id: "example", currency: "USD", defaults: { categoryId: "category", bucketId: "group" },
  categories: [{ id: "category", name: "Groceries", isArchived: true }],
  buckets: [{ id: "group", name: "Household", isArchived: false }],
  draft: { kind: "expense", amount: "100", splitMode: false, splits: [{ key: "one", categoryId: "category", bucketId: "group", amount: "100" }] },
  onChange: () => {},
};

describe("shared expense allocation controls", () => {
  it("makes division visible with optional responsibility help and retained archived labels", () => {
    const html = renderToStaticMarkup(<ExpenseAllocationFields {...props} />);
    expect(html).toContain("Divide this expense");
    expect(html).toContain('aria-label="Help: Responsible for"');
    expect(html).toContain("Groceries (archived)");
    expect(html).toContain("Responsible for (required)");
  });
  it("associates incomplete and wrong-sign errors with required parts and an announced exact balance", () => {
    const draft = { ...props.draft, splitMode: true, splits: [{ ...props.draft.splits[0], key: "one", categoryId: "category", bucketId: "group", amount: "60" }, { key: "two", categoryId: "category", bucketId: "group", amount: "-40" }] };
    const html = renderToStaticMarkup(<ExpenseAllocationFields {...props} draft={draft} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Original total:");
    expect(html).toContain("Still to assign 40.00 USD");
    expect(html).toContain('aria-describedby="example-summary example-two-amount-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Enter a positive amount. The transaction kind determines its sign.");
    expect(html).toContain("Remove part 2");
    expect(html).toContain("Add another part");
  });
  it("keeps refunds divisible and retains income and transfer treatment", () => {
    expect(renderToStaticMarkup(<ExpenseAllocationFields {...props} draft={{ ...props.draft, splitMode: true, kind: "refund" }} />)).toContain("Divide this expense");
    for (const kind of ["income", "transfer"] as const) {
      const html = renderToStaticMarkup(<ExpenseAllocationFields {...props} draft={{ ...props.draft, kind }} />);
      expect(html).toContain("Income and transfers do not count as spending.");
      expect(html).not.toContain("Divide this expense");
    }
  });
});
