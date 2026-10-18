import { z } from "zod";

export const guideStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account") }),
  z.object({ kind: z.literal("choice"), accountId: z.string() }),
  z.object({ kind: z.literal("entry"), accountId: z.string(), path: z.enum(["manual", "csv"]) }),
]);
export type GuideStep = z.infer<typeof guideStepSchema>;
export const guideResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual"), description: z.string() }),
  z.object({ kind: z.literal("csv"), added: z.number().int().positive(), batchId: z.string() }),
]);
export type GuideResult = z.infer<typeof guideResultSchema>;
const guideStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("active"), step: guideStepSchema }),
  z.object({ kind: z.literal("skipped"), step: guideStepSchema }),
  z.object({ kind: z.literal("result"), result: guideResultSchema }),
  z.object({ kind: z.literal("finished") }),
]);
export type GuideState = z.infer<typeof guideStateSchema>;
export const guideEvent = "homebooks-first-entry";
export const guideCompletionSchema = z.object({ sheetId: z.string(), result: guideResultSchema });
export function guideKey(userId: string, sheetId: string) {
  return `homebooks:guide:${encodeURIComponent(userId)}:${encodeURIComponent(sheetId)}`;
}
export function parseGuideState(raw: string | null): GuideState {
  try { const parsed = guideStateSchema.safeParse(JSON.parse(raw ?? "null")); return parsed.success ? parsed.data : { kind: "new" }; }
  catch { return { kind: "new" }; }
}
export function availableGuideStep(step: GuideStep, accounts: { id: string; isArchived: boolean }[]): GuideStep {
  return step.kind !== "account" && !accounts.some(account => account.id === step.accountId && !account.isArchived) ? { kind: "account" } : step;
}
export function notifyFirstEntry(sheetId: string, result: GuideResult) {
  window.dispatchEvent(new CustomEvent(guideEvent, { detail: { sheetId, result } }));
}
