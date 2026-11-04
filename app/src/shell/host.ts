/**
 * Per-feature host wrappers: every feature gets its own `<div data-feature=id>` in each slot. The
 * wrappers are removed on unmount, and panel/tool wrappers are attached to the document only from
 * the feature's `panelTier` on — below it they are detached (not reachable), never CSS-hidden.
 */
import type { AppContext } from '../main';
import { attachOrdered, el } from './dom';
import type { FeatureDef, HostHandle } from './registry';
import { tierAllows } from './tiers';
import type { Tier } from './tiers';
import type { FeatureHost, ShellApi, ShellServices } from './types';

export interface HostSlots {
  panel: HTMLElement;
  tools: HTMLElement;
  places: HTMLElement;
  hud: HTMLElement;
  /** Detached container the settings dialog moves into its body while open. */
  settings: HTMLElement;
  overlay: HTMLElement;
}

let seq = 0;

export function createHostFactory(ctx: AppContext, shell: () => ShellApi, services: ShellServices, slots: HostSlots) {
  return (def: FeatureDef<FeatureHost>, tier: Tier): HostHandle<FeatureHost> => {
    const n = String(++seq);
    const wrap = (slot: keyof HostSlots) => el('div', { class: `sle-feat sle-feat-${slot}`, 'data-feature': def.id, 'data-seq': n });
    const w = {
      panel: wrap('panel'),
      tools: wrap('tools'),
      places: wrap('places'),
      hud: wrap('hud'),
      settings: wrap('settings'),
      overlay: wrap('overlay'),
    };
    // Always attached: places, hud, overlay, settings (the settings container itself is detached when closed).
    for (const k of ['places', 'hud', 'overlay', 'settings'] as const) attachOrdered(slots[k], w[k]);
    const panelTier = def.panelTier ?? def.tier;
    const retier = (t: Tier) => {
      for (const k of ['panel', 'tools'] as const) {
        if (tierAllows(t, panelTier)) attachOrdered(slots[k], w[k]);
        else w[k].remove();
      }
    };
    retier(tier);
    const host: FeatureHost = {
      ctx,
      get shell() {
        return shell();
      },
      services,
      ...w,
    };
    return {
      host,
      retier,
      release: () => Object.values(w).forEach((x) => x.remove()),
    };
  };
}
