import { expect, it } from "vitest";
import { availableGuideStep, guideCompletionSchema, guideKey, parseGuideState } from "./guide";

it("scopes guide preferences to stable user and sheet identities", () => {
  expect(guideKey("user", "sheet")).toBe(guideKey("user", "sheet"));
  expect(guideKey("user", "sheet")).not.toBe(guideKey("other", "sheet"));
  expect(guideKey("user", "sheet")).not.toBe(guideKey("user", "other"));
  expect(guideKey("user:other", "sheet")).not.toBe(guideKey("user", "other:sheet"));
});
it("retains skipped and resumed paths through persisted preferences", () => {
  const state = { kind: "skipped", step: { kind: "entry", accountId: "cash", path: "csv" } };
  expect(parseGuideState(JSON.stringify(state))).toEqual(state);
  expect(parseGuideState(JSON.stringify({ kind: "active", step: state.step }))).toEqual({ kind: "active", step: state.step });
  for (const raw of [null, "bad JSON", '{"kind":"active"}', '{"kind":"result","result":{"kind":"csv","added":0,"batchId":"batch"}}']) expect(parseGuideState(raw)).toEqual({ kind: "new" });
});
it("returns to the account step if an account was archived or removed", () => {
  const step = { kind: "entry", accountId: "cash", path: "manual" } satisfies Parameters<typeof availableGuideStep>[0];
  expect(availableGuideStep(step, [{ id: "cash", isArchived: false }])).toEqual(step);
  expect(availableGuideStep(step, [{ id: "cash", isArchived: true }])).toEqual({ kind: "account" });
  expect(availableGuideStep(step, [])).toEqual({ kind: "account" });
});
it("accepts real saved entry results and rejects zero-added imports", () => {
  expect(guideCompletionSchema.safeParse({ sheetId: "sheet", result: { kind: "manual", description: "Lunch" } }).success).toBe(true);
  expect(guideCompletionSchema.safeParse({ sheetId: "sheet", result: { kind: "csv", added: 2, batchId: "batch" } }).success).toBe(true);
  expect(guideCompletionSchema.safeParse({ sheetId: "sheet", result: { kind: "csv", added: 0, batchId: "batch" } }).success).toBe(false);
});
