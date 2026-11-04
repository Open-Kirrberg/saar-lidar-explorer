/**
 * Lens targets (V2.5): things the Relikt-Blick lens fades out — the instanced trees (V2.4b,
 * `window.sleTrees`), the relief lab's DSM canopy, later zone props. A target only needs
 * `setLensFade(f)`, f = 0 shown … 1 hidden. Pure apart from the injected `extra()` lookup.
 */
export interface LensTarget {
  setLensFade(f: number): void;
}

export interface LensTargets {
  /** Add a target; it gets the current fade at once. Returns an unregister function (resets it to 0). */
  register(t: LensTarget): () => void;
  /** Push fade `f` to every target (no-op when unchanged unless `force`). */
  apply(f: number, force?: boolean): void;
  /** Give targets that appeared since the last apply (e.g. trees loaded late) the current fade. */
  sync(): void;
  current(): number;
}

/**
 * `extra()` returns targets looked up at call time (e.g. `window.sleTrees`), so a module that
 * never registers still follows the lens.
 */
export function createLensTargets(extra: () => readonly LensTarget[] = () => []): LensTargets {
  const own = new Set<LensTarget>();
  const seen = new WeakSet<LensTarget>();
  let fade = 0;
  let warned = false;
  const call = (t: LensTarget, f: number) => {
    try {
      t.setLensFade(f);
    } catch (err) {
      if (!warned) console.warn('[lens] target failed', err);
      warned = true;
    }
  };
  const all = (): LensTarget[] => {
    const list = [...own];
    for (const t of extra()) if (t && typeof t.setLensFade === 'function' && !own.has(t)) list.push(t);
    return list;
  };
  return {
    register(t) {
      own.add(t);
      seen.add(t);
      call(t, fade);
      return () => {
        if (own.delete(t)) call(t, 0);
      };
    },
    apply(f, force = false) {
      const v = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
      if (v === fade && !force) return;
      fade = v;
      for (const t of all()) {
        seen.add(t);
        call(t, v);
      }
    },
    sync() {
      for (const t of all()) {
        if (seen.has(t)) continue;
        seen.add(t);
        call(t, fade);
      }
    },
    current: () => fade,
  };
}
