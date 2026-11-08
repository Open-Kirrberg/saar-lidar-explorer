/** Layout helper (pure): keep floating cards (lens card, zone prompt) clear of the shell's splash + „© Quellen“ corner. */

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

const hits = (a: Box, bs: readonly Box[]) => bs.some((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);

export interface CornerInput {
  /** The shell box (viewport px). */
  host: Box;
  /** Top edge of the open bottom sheet (its natural height, before any cap from here). */
  sheetTop: number;
  /** Size of the corner (splash + „© Quellen“). */
  size: { w: number; h: number };
  /** Side gap (`--gap`). */
  gap: number;
  /** Space between sheet and corner. */
  lift: number;
  /** Controls in the right column the corner must not cover (minimap, system buttons). */
  right: readonly Box[];
  /** Controls on the left (HUD). */
  left: readonly Box[];
}

export interface CornerSpot {
  side: 'right' | 'left';
  /** CSS `bottom` of the corner (px from the host's bottom). */
  bottom: number;
  /** The sheet top to use: the natural one, or lower (the sheet is capped) when neither side has room. */
  sheetTop: number;
}

/**
 * Phones, sheet open: „© Quellen“ (ADR 0026: always visible) sits right above the sheet. Right-aligned
 * when that is clear of the minimap / system buttons; else left-aligned when clear of the HUD; else
 * right-aligned with the sheet capped so its top leaves room below the right-hand controls.
 */
export function placeCorner(i: CornerInput): CornerSpot {
  const at = (sheetTop: number, side: 'right' | 'left'): Box => {
    const bottom = sheetTop - i.lift;
    const top = bottom - i.size.h;
    return side === 'right'
      ? { left: i.host.right - i.gap - i.size.w, right: i.host.right - i.gap, top, bottom }
      : { left: i.host.left + i.gap, right: i.host.left + i.gap + i.size.w, top, bottom };
  };
  const spot = (side: 'right' | 'left', sheetTop: number): CornerSpot => ({ side, sheetTop, bottom: Math.round(i.host.bottom - sheetTop + i.lift) });
  if (!hits(at(i.sheetTop, 'right'), i.right)) return spot('right', i.sheetTop);
  if (!hits(at(i.sheetTop, 'left'), [...i.left, ...i.right])) return spot('left', i.sheetTop);
  const r = at(i.sheetTop, 'right');
  const below = i.right.filter((b) => r.left < b.right && b.left < r.right).reduce((m, b) => Math.max(m, b.bottom), i.host.top);
  return spot('right', Math.max(i.sheetTop, Math.ceil(below + i.lift + i.size.h + i.lift)));
}
