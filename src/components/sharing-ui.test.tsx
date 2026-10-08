import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PeopleSettings } from "./people-settings";
import { IncomingInvites } from "./incoming-invites";
import { hasLostSheetAccess, loseSheetAccess, resetSheetAccess, restoreSheetAccess, sheetAccessEvent, sheetFailure } from "./sheet-access";

afterEach(() => { resetSheetAccess(); vi.unstubAllGlobals(); });
it("keeps safe incoming invitation identities and actions available without sheet data", () => {
  const html = renderToStaticMarkup(<IncomingInvites invites={[{ id: "invite", sheetId: "sheet", sheetName: "Household", inviterName: "Dana", inviterUsername: "dana", state: "pending", createdAt: "2026-10-07" }]} loading={false} error="" retry={() => undefined} onResolved={async () => undefined} onOpenSheet={() => undefined} onPending={() => undefined} />);
  expect(html).toContain("Household"); expect(html).toContain("Dana @dana");
  expect(html).toContain("Accept"); expect(html).toContain("Decline");
  expect(html).not.toContain("$"); expect(html).not.toContain("account");
});
it("shows a retry on inbox errors and a distinct empty inbox", () => {
  const props = { loading: false, retry: () => undefined, onResolved: async () => undefined, onOpenSheet: () => undefined, onPending: () => undefined };
  const failed = renderToStaticMarkup(<IncomingInvites {...props} invites={null} error="Connection failed" />);
  expect(failed).toContain("Retry invitations"); expect(failed).not.toContain("No pending invitations");
  expect(renderToStaticMarkup(<IncomingInvites {...props} invites={[]} error="" />)).toContain("No pending invitations");
});
it("gives members People and leave without owner controls", () => {
  const sheet = { id: "sheet", name: "Household", currency: "USD", role: "member", people: [{ id: "owner", name: "Dana", username: "dana", role: "owner" }, { id: "member", name: "Alex", username: "alex", role: "member" }], accounts: [], categories: [], buckets: [] } satisfies Parameters<typeof PeopleSettings>[0]["sheet"];
  const member = renderToStaticMarkup(<PeopleSettings sheet={sheet} />);
  expect(member).toContain("Dana"); expect(member).toContain("@alex"); expect(member).toContain("Leave sheet");
  expect(member).not.toContain("Invite someone"); expect(member).not.toContain("Remove "); expect(member).not.toContain("Revoke ");
  const owner = renderToStaticMarkup(<PeopleSettings sheet={{ ...sheet, role: "owner" }} />);
  expect(owner).toContain("Invite someone"); expect(owner).toContain("Remove "); expect(owner).toContain("Pending invitations"); expect(owner).not.toContain("Leave sheet");
});
it("broadcasts access loss and blocks cached rendering until a new acceptance restores access", () => {
  const events = new EventTarget(); vi.stubGlobal("window", events);
  const received: unknown[] = []; events.addEventListener(sheetAccessEvent, (event) => { if (event instanceof CustomEvent) received.push(event.detail); });
  loseSheetAccess("sheet", 404);
  expect(hasLostSheetAccess("sheet")).toBe(true); expect(hasLostSheetAccess("other")).toBe(false);
  expect(received).toEqual([{ sheetId: "sheet", status: 404 }]);
  restoreSheetAccess("sheet"); expect(hasLostSheetAccess("sheet")).toBe(false);
});
it("distinguishes a missing record from lost sheet access before clearing UI", async () => {
  vi.stubGlobal("window", new EventTarget());
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 404 })); vi.stubGlobal("fetch", fetcher);
  expect(await sheetFailure(new Response("{}", { status: 404 }), "sheet")).toBe(false);
  expect(hasLostSheetAccess("sheet")).toBe(false);
  expect(await sheetFailure(new Response("{}", { status: 404 }), "sheet")).toBe(true);
  expect(hasLostSheetAccess("sheet")).toBe(true);
  expect(fetcher).toHaveBeenCalledWith("/api/sheets/sheet", { cache: "no-store" });
});
