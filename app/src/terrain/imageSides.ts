/** Pure: the four chunk sides used by the image apron (imageApron.ts). +i = east, +j = south. */
export type Side = 'n' | 's' | 'w' | 'e';

export const SIDES: readonly Side[] = ['n', 's', 'w', 'e'];
export const SIDE_BIT: Record<Side, number> = { n: 1, s: 2, w: 4, e: 8 };
export const SIDE_OFFSET: Record<Side, readonly [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

export function opposite(s: Side): Side {
  return s === 'n' ? 's' : s === 's' ? 'n' : s === 'w' ? 'e' : 'w';
}

/** Image UV with a 1-texel apron: chunk-relative u ∈ [0, 1] over P image px → (u·P + 1) / (P + 2). */
export function apronImageUv(u: number, P: number): number {
  return (u * P + 1) / (P + 2);
}
