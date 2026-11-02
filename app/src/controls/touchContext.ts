import type { TouchController } from './TouchController';

/** The bits of the Fundmarker / Messen tools the long-press action needs (structural types). */
export interface TapTool {
  readonly active: boolean;
  setActive(on: boolean): void;
}

export type LongPressAction = 'measure' | 'marker' | 'none';

/**
 * What a long-press does (pure): add a measuring point while Messen is on, otherwise place a
 * Fundmarker (switching "Markieren" on if needed). No terrain under the finger → nothing.
 */
export function longPressAction(hasPoint: boolean, measureActive: boolean): LongPressAction {
  if (!hasPoint) return 'none';
  return measureActive ? 'measure' : 'marker';
}

/**
 * F20 default long-press context action, replacing right-click/M on touch devices. The marker and
 * measuring tools are tap-driven (pointerdown+pointerup on the canvas), so the action forwards a
 * synthetic tap at the finger position: Messen adds a vertex, Markieren opens the marker form.
 */
export function bindLongPressContext(
  touch: TouchController,
  tools: { markers: TapTool; measure: () => TapTool | undefined },
): () => void {
  return touch.onLongPress((e) => {
    const measure = tools.measure();
    const action = longPressAction(e.point !== null, !!measure?.active);
    if (action === 'none') return;
    if (action === 'marker' && !tools.markers.active) tools.markers.setActive(true);
    touch.synthesizeTap(e.clientX, e.clientY);
  });
}
