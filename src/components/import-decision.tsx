import type { ReactNode } from "react";
import { importDecisionLabels, reviewRowSchema, type ReviewRow } from "../imports/presentation";
import { Selector } from "./ui";

const choices = ["pending", "keep", "exclude", "skip"] satisfies ReviewRow["decision"][];
export function ImportDecision({ id, value, allowMatchingCount, disabled = false, required = false, error, autoFocus = false, onChange, labelHelp }: {
  labelHelp?: ReactNode; id: string; value: ReviewRow["decision"]; allowMatchingCount: boolean; disabled?: boolean; required?: boolean; error?: string; autoFocus?: boolean;
  onChange: (decision: ReviewRow["decision"]) => void;
}) {
  return <div className="import-decision"><Selector id={id} label="Import?" labelHelp={labelHelp} aria-required={required} autoFocus={autoFocus} value={value} disabled={disabled} error={error} onChange={event => onChange(reviewRowSchema.shape.decision.parse(event.target.value))}>{choices.filter(choice => choice !== "skip" || allowMatchingCount).map(choice => <option key={choice} value={choice}>{importDecisionLabels[choice]}</option>)}</Selector></div>;
}
