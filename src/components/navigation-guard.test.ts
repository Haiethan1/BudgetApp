import { afterEach, expect, it, vi } from "vitest";
import { appNavigationEvent, requestAppNavigation } from "./navigation-guard";

afterEach(() => vi.unstubAllGlobals());
it("lets buttons navigate normally and allows an unsaved review guard to cancel without losing its destination", () => {
  const events = new EventTarget(); vi.stubGlobal("window", events);
  const navigate = vi.fn();
  requestAppNavigation({ href: "/settings#people-heading", navigate });
  expect(navigate).toHaveBeenCalledWith("/settings#people-heading");
  navigate.mockClear();
  const destinations: unknown[] = [];
  events.addEventListener(appNavigationEvent, (event) => {
    if (event instanceof CustomEvent) destinations.push(event.detail);
    event.preventDefault();
  });
  requestAppNavigation({ href: "/settings#people-heading", navigate });
  expect(navigate).not.toHaveBeenCalled();
  expect(destinations).toEqual([{ href: "/settings#people-heading" }]);
});
