import { describe, expect, it } from "vitest";
import { mappingSchema } from "./input";
import { importPreferenceKey, missingMappingColumns, preferredImportAccount, preferredImportProfile, readImportPreferences } from "./preferences";

const mapping = mappingSchema.parse({ version: 1, profile: "Card", date: "Date", payee: "Payee", sourceId: "ID", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } });
describe("remembered import defaults", () => {
  it("prioritizes a valid explicit launch account over remembered preferences, with safe fallbacks", () => {
    const accounts = [{ id: "first", isArchived: false }, { id: "launch", isArchived: false }, { id: "remembered", isArchived: false }, { id: "archived", isArchived: true }];
    expect(preferredImportAccount(accounts, "remembered", "launch")).toBe("launch");
    for (const launch of [undefined, "archived", "foreign"]) expect(preferredImportAccount(accounts, "remembered", launch)).toBe("remembered");
    expect(preferredImportAccount(accounts, "missing", "foreign")).toBe("first");
  });
  it("uses the remembered active account and falls back when it is archived, missing, or from another sheet", () => {
    const accounts = [{ id: "first", isArchived: false }, { id: "archived", isArchived: true }, { id: "last", isArchived: false }];
    expect(preferredImportAccount(accounts, "last")).toBe("last");
    for (const id of ["", "archived", "deleted", "other-sheet-account"]) expect(preferredImportAccount(accounts, id)).toBe("first");
    expect(preferredImportAccount([{ id: "archived", isArchived: true }], "archived")).toBe("");
  });
  it("uses a last-used profile only from the selected account and falls back to its first saved profile", () => {
    const profiles = [{ id: "other", accountId: "other-account", name: "Wrong card", version: 1, mapping }, { id: "first", accountId: "card", name: "First", version: 1, mapping }, { id: "last", accountId: "card", name: "Last", version: 1, mapping }];
    expect(preferredImportProfile(profiles, "card", "last")?.id).toBe("last");
    expect(preferredImportProfile(profiles, "card", "other")?.id).toBe("first");
    expect(preferredImportProfile(profiles, "card", "deleted")?.id).toBe("first");
    expect(preferredImportProfile(profiles, "new-account", "last")).toBeUndefined();
  });
  it("scopes preferences to the user and sheet and tolerates unavailable or corrupt storage", () => {
    const key = importPreferenceKey("alice", "household");
    expect(key).not.toBe(importPreferenceKey("bob", "household"));
    expect(key).not.toBe(importPreferenceKey("alice", "personal"));
    expect(readImportPreferences({ getItem: () => '{"accountId":"card","profileIds":{"card":"saved"}}' }, key)).toEqual({ accountId: "card", profileIds: { card: "saved" } });
    for (const value of [null, "invalid", '{"accountId":5,"profileIds":{}}']) expect(readImportPreferences({ getItem: () => value }, key)).toEqual({ accountId: "", profileIds: {} });
    expect(readImportPreferences({ getItem: () => { throw new Error("Storage disabled"); } }, key)).toEqual({ accountId: "", profileIds: {} });
  });
  it("checks every saved column against the current CSV, including optional IDs and debit-credit fields", () => {
    expect(missingMappingColumns(mapping, ["Date", "Payee", "Amount", "ID"])).toEqual([]);
    expect(missingMappingColumns(mapping, ["Date", "Payee"])).toEqual(["ID", "Amount"]);
    expect(missingMappingColumns({ ...mapping, money: { mode: "debit-credit", debit: "Debit", credit: "Credit", unused: "blank" } }, ["Date", "Payee", "Debit"])).toEqual(["ID", "Credit"]);
  });
});
