/**
 * Public-bundle guard (ADR 0010, ADR 0020, V2.1): F21 (3D print, now the `sle-print` repo) and F22
 * (crater / UXO indicators, now the private `sle-craters-private` repo) must never ship again. The
 * build fails when an emitted JS/CSS chunk contains one of these distinctive strings
 * (vite.config.ts `bundleGuard()`); unit-tested in tests/bundleGuard.test.ts.
 */
export const FORBIDDEN_IN_BUNDLE: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /crater/i, why: 'F22 crater classes (private, ADR 0010)' },
  { re: /Bombentrichter|Trichterfeld|Trichterverdacht/, why: 'F22 crater labels (private, ADR 0010)' },
  { re: /Kampfmittel\/Blindg/, why: 'F22 UXO note (private, ADR 0010)' },
  { re: /print3d|VITE_PRINT_URL/i, why: 'F21 3D print (moved to sle-print)' },
  { re: /3D-Druck|Druckkachel/, why: 'F21 3D print UI (moved to sle-print)' },
];

/** Reasons for every forbidden pattern found in `code` (empty = clean). */
export function findForbidden(code: string): string[] {
  return FORBIDDEN_IN_BUNDLE.filter((f) => f.re.test(code)).map((f) => `${f.re.source} – ${f.why}`);
}
