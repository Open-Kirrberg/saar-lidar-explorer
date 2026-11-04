/**
 * „Gewissheit“ (Entdecker tier, V2.7): one select instead of the confidence colours and the low-confidence switch.
 * Pure: maps the mode onto the two display keys the renderer already has (applyDisplay in castle.ts).
 */
export type GewissheitMode = 'aus' | 'farben' | 'durchscheinend' | 'ausblenden';
export type LowConfidence = 'show' | 'translucent' | 'hide';

export const GEWISSHEIT_OPTIONS: readonly { value: GewissheitMode; label_de: string }[] = [
  { value: 'aus', label_de: 'aus' },
  { value: 'farben', label_de: 'Farben nach Gewissheit' },
  { value: 'durchscheinend', label_de: 'Unsicheres durchscheinend' },
  { value: 'ausblenden', label_de: 'Unsicheres ausblenden' },
];

export function gewissheit(mode: GewissheitMode): { confidenceColours: boolean; lowConfidence: LowConfidence } {
  switch (mode) {
    case 'farben':
      return { confidenceColours: true, lowConfidence: 'show' };
    case 'durchscheinend':
      return { confidenceColours: false, lowConfidence: 'translucent' };
    case 'ausblenden':
      return { confidenceColours: false, lowConfidence: 'hide' };
    default:
      return { confidenceColours: false, lowConfidence: 'show' };
  }
}

/** Inverse for the select (a state set by `skb.set` may combine both keys; colours win). */
export function gewissheitOf(s: { confidenceColours: boolean; lowConfidence: LowConfidence }): GewissheitMode {
  if (s.confidenceColours) return 'farben';
  return s.lowConfidence === 'translucent' ? 'durchscheinend' : s.lowConfidence === 'hide' ? 'ausblenden' : 'aus';
}

export function isGewissheit(x: unknown): x is GewissheitMode {
  return x === 'aus' || x === 'farben' || x === 'durchscheinend' || x === 'ausblenden';
}
