export function positionHelp({ anchor, popup, viewport }: {
  anchor: Pick<DOMRect, "left" | "top" | "bottom" | "width">;
  popup: Pick<DOMRect, "width" | "height">;
  viewport: { width: number; height: number };
}) {
  const edge = 12;
  const left = Math.max(edge, Math.min(anchor.left, viewport.width - popup.width - edge));
  const below = anchor.bottom + 8;
  const placement = below + popup.height <= viewport.height - edge ? "below" : "above";
  const preferredTop = placement === "below" ? below : anchor.top - popup.height - 8;
  const top = Math.max(edge, Math.min(preferredTop, viewport.height - popup.height - edge));
  const arrow = Math.max(12, Math.min(popup.width - 20, anchor.left + anchor.width / 2 - left));
  return { left, top, placement, arrow };
}
