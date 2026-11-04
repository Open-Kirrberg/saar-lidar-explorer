/** Card layout helper (pure): keep the lens card clear of the shell's splash + „© Quellen“ corner. */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The corner must never be covered (ADR 0026), and the card must not hide under it (the start splash
 * sits there for its first seconds). If `card` overlaps `keep`, returns the CSS `bottom` / `max-height`
 * (px) that lift the card above `keep`; otherwise null (stay where the stylesheet put it).
 */
export function clearOf(card: Box, keep: Box, viewportH: number, gap = 8, minTop = 8): { bottom: number; maxHeight: number } | null {
  const overlapX = card.left < keep.right && keep.left < card.right;
  const overlapY = card.top < keep.bottom && keep.top < card.bottom;
  if (!overlapX || !overlapY) return null;
  return { bottom: Math.max(0, viewportH - keep.top + gap), maxHeight: Math.max(120, keep.top - gap - minTop) };
}
