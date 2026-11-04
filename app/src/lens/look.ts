/**
 * Game look (V2.5, ADR 0018/0035): in Standard and Entdecker the ground is the aerial photo
 * (`ortho`) — with sky, LoD2 houses and the V2.4 trees on top — instead of the grey relief. Labor
 * keeps the relief lab exactly as before.
 *
 * The look drives Terrain directly and never writes the store's `layer`, so the relief lab's
 * choice (settings, URL hash) survives a visit to Standard. A relief-lab overlay is put aside
 * while the look is active and restored when Labor comes back in the same session.
 */
import type { FeatureHost } from '../shell/types';
import type { Tier } from '../shell/tiers';

/** Ground layer of the game look, if the AOI has it (else the classic default stays). */
export function gameLookKey(isImage: (key: string) => boolean): string | null {
  return isImage('ortho') ? 'ortho' : null;
}

export const gameLookActive = (tier: Tier): boolean => tier !== 'labor';

export function mountLook(h: FeatureHost): () => void {
  const { ctx, shell } = h;
  const t = ctx.terrain;
  const key = gameLookKey((k) => t.isImageKey(k));
  if (!key) return () => {};
  let parkedOverlay: string | null = null;
  let applying = false;

  const apply = () => {
    if (applying || !gameLookActive(shell.tier())) return;
    applying = true;
    try {
      if (t.getDisplay() !== key) t.setDisplay(key);
      const o = t.getOverlay().key;
      if (o) {
        parkedOverlay = o;
        t.setOverlay({ key: '' });
      }
    } finally {
      applying = false;
    }
  };
  const restore = () => {
    const s = ctx.store.get();
    t.setDisplay(s.layer, s.colormap);
    if (parkedOverlay && !t.getOverlay().key) t.setOverlay({ key: parkedOverlay });
    parkedOverlay = null;
  };

  apply();
  // Store writes of these keys re-apply the lab display in main.ts (hash, settings) → take the ground back.
  const offStore = ctx.store.subscribe(() => apply(), ['layer', 'colormap', 'sunAzimuth', 'sunElevation', 'sunDirections', 'overlay']);
  const offTier = shell.onTier((tier) => (gameLookActive(tier) ? apply() : restore()));
  return () => {
    offStore();
    offTier();
    if (gameLookActive(shell.tier())) restore();
  };
}
