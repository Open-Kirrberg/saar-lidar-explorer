/**
 * V2.5 game look + Relikt-Blick lens (ADR 0035). Registered from main.ts right after the shell:
 *
 * | id            | tier      | what                                                            |
 * |---------------|-----------|-----------------------------------------------------------------|
 * | look          | standard  | aerial-photo ground in Standard/Entdecker (Labor: relief lab)   |
 * | lens          | standard  | Relikt-Blick toggle (F), tree fade, relief blend, glow, card     |
 * | lens-variants | entdecker | 3 relief variants + Zeitreise 1840/1935 chips in the tool row    |
 *
 * `window.sleLens` exposes the API (incl. `registerLensTarget` for trees / props).
 */
import type { AppContext } from '../main';
import { createLens } from './Lens';
import type { LensApi } from './Lens';
import { mountLook } from './look';

declare global {
  interface Window {
    sleLens?: LensApi;
  }
}

export type { LensApi } from './Lens';
export type { LensTarget } from './targets';

export function registerLens(ctx: AppContext): LensApi {
  const lens = createLens(ctx);
  window.sleLens = lens.api;
  const reg = ctx.shell.registerFeature;
  reg({ id: 'look', tier: 'standard', label: 'Spiel-Look (Luftbild statt Relief)', mount: (h) => mountLook(h) });
  reg({ id: 'lens', tier: 'standard', label: 'Relikt-Blick (Taste F)', mount: (h) => lens.mountLens(h) });
  reg({
    id: 'lens-variants',
    tier: 'entdecker',
    label: 'Relikt-Blick: Varianten + Zeitreise',
    available: () => lens.api.variants().length > 1,
    mount: (h) => lens.mountVariants(h),
  });
  return lens.api;
}
