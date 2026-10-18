import { z } from "zod";

export const setupFactsSchema = z.object({
  accounts: z.number().int().nonnegative(), categories: z.number().int().nonnegative(),
  groups: z.number().int().nonnegative(), budgets: z.number().int().nonnegative(),
  formats: z.number().int().nonnegative(), cycleDay: z.number().int().min(1).max(31),
  completed: z.boolean().default(false),
});
export type SetupFacts = z.input<typeof setupFactsSchema>;
export function setupProgress(facts: SetupFacts) {
  const optionalConfigured = [facts.categories, facts.groups, facts.budgets, facts.formats].filter((count) => count > 0).length;
  return { ready: facts.accounts > 0, optionalConfigured, hasOpportunities: !facts.completed && (facts.accounts === 0 || optionalConfigured < 4) };
}
