import { expect, it } from "vitest";
import { positionHelp } from "./help-position";

it("keeps a pinned desktop help popup visible after the form moves below a phone viewport", () => {
  const popup = { width: 360, height: 104 };
  const viewport = { width: 390, height: 844 };
  const position = positionHelp({ anchor: { left: 18, top: 946, bottom: 970, width: 24 }, popup, viewport });
  expect(position.top).toBeGreaterThanOrEqual(12);
  expect(position.top + popup.height).toBeLessThanOrEqual(viewport.height - 12);
  expect(position.left).toBeGreaterThanOrEqual(12);
  expect(position.left + popup.width).toBeLessThanOrEqual(viewport.width - 12);
});

it("fits partially visible and scrolled anchors at every viewport edge", () => {
  const popup = { width: 280, height: 120 };
  const viewport = { width: 320, height: 400 };
  for (const anchor of [
    { left: -5, top: -12, bottom: 12, width: 24 },
    { left: 310, top: 388, bottom: 412, width: 24 },
    { left: 600, top: 800, bottom: 824, width: 24 },
  ]) {
    const position = positionHelp({ anchor, popup, viewport });
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.left + popup.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(position.top + popup.height).toBeLessThanOrEqual(viewport.height - 12);
  }
});

it("prefers below a visible label and flips above when there is room there", () => {
  const popup = { width: 200, height: 100 };
  const viewport = { width: 390, height: 844 };
  expect(positionHelp({ anchor: { left: 40, top: 60, bottom: 84, width: 24 }, popup, viewport }).placement).toBe("below");
  const above = positionHelp({ anchor: { left: 40, top: 760, bottom: 784, width: 24 }, popup, viewport });
  expect(above.placement).toBe("above");
  expect(above.top + popup.height).toBeLessThan(760);
});
