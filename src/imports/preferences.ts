import { z } from "zod";
import type { Mapping } from "./input";
import type { profilesSchema } from "./presentation";

const preferencesSchema = z.object({ accountId: z.string(), profileIds: z.record(z.string(), z.string()) });
export type ImportPreferences = z.infer<typeof preferencesSchema>;
export const emptyImportPreferences = (): ImportPreferences => ({ accountId: "", profileIds: {} });
export function importPreferenceKey(userId: string, sheetId: string) {
  return `homebooks:import:${encodeURIComponent(userId)}:${encodeURIComponent(sheetId)}`;
}
export function readImportPreferences(storage: Pick<Storage, "getItem">, key: string): ImportPreferences {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(storage.getItem(key) ?? "null"));
    return parsed.success ? parsed.data : emptyImportPreferences();
  } catch { return emptyImportPreferences(); }
}
export function preferredImportAccount(accounts: { id: string; isArchived: boolean }[], preferred: string, launchAccount?: string) {
  const active = accounts.filter((account) => !account.isArchived);
  return active.find((account) => account.id === launchAccount)?.id ?? active.find((account) => account.id === preferred)?.id ?? active[0]?.id ?? "";
}
export function preferredImportProfile(profiles: z.infer<typeof profilesSchema>, accountId: string, preferred: string | undefined) {
  const available = profiles.filter((profile) => profile.accountId === accountId);
  return available.find((profile) => profile.id === preferred) ?? available[0];
}
export function missingMappingColumns(mapping: Mapping, headers: string[]) {
  const columns = [mapping.date, mapping.payee, ...(mapping.sourceId ? [mapping.sourceId] : []),
    ...(mapping.money.mode === "signed" ? [mapping.money.amount] : [mapping.money.debit, mapping.money.credit])];
  return [...new Set(columns)].filter((column) => !headers.includes(column));
}
