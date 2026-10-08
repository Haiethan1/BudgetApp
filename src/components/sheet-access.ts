const lostSheets = new Set<string>();
export const sheetAccessEvent = "homebooks-sheet-access-lost";
export function hasLostSheetAccess(sheetId: string) { return lostSheets.has(sheetId); }
export function restoreSheetAccess(sheetId: string) { lostSheets.delete(sheetId); }
export function resetSheetAccess() { lostSheets.clear(); }
export function loseSheetAccess(sheetId: string, status: number) {
  lostSheets.add(sheetId);
  window.dispatchEvent(new CustomEvent(sheetAccessEvent, { detail: { sheetId, status } }));
}
export function requestShare() { window.dispatchEvent(new Event("homebooks-open-share")); }
export async function sheetFailure(response: Response, sheetId: string) {
  if (response.status === 401) { loseSheetAccess(sheetId, 401); return true; }
  if (response.status !== 404) return false;
  const access = await fetch(`/api/sheets/${sheetId}`, { cache: "no-store" });
  if (access.status === 401 || access.status === 404) { loseSheetAccess(sheetId, access.status); return true; }
  return false;
}
