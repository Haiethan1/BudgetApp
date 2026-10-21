import { IntentLink } from "./intent-link";
import type { readPlanAttention } from "../plans/service";

export function PlanAttention({ attention }: { attention: ReturnType<typeof readPlanAttention> }) {
  if (!attention.active && !attention.needsReview) return null;
  return <p className="plan-attention" role="status">Payment plans: {attention.active} active{attention.overdue ? ` · ${attention.overdue} overdue` : ""}{attention.needsReview ? ` · ${attention.needsReview} need source review` : ""}. <IntentLink href="/budgets#upcoming-payments">Open payment plans</IntentLink></p>;
}
