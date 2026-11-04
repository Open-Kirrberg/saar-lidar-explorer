/**
 * Render scale and quality presets (backlog KB-I05, visual-audit P7). Pure: no three.js, no DOM.
 *
 * - Presets cap the device pixel ratio: Hoch 1.5, Mittel 1.25, Mobil 1.0 (2.0 only for stills / photo mode).
 *   At 1512×982 pt on a retina MacBook that is 2268×1473 (Hoch) and 1890×1228 (Mittel) instead of 3024×1964.
 * - The adaptive controller lowers the scale when the moving-average GPU frame time exceeds the budget (14 ms) and
 *   raises it again when there is clear headroom. It never goes below 1 device pixel per CSS pixel on a retina screen
 *   (or below the device ratio on a non-retina one), so 1:1 screenshots stay deterministic.
 */

export type QualityPreset = 'hoch' | 'mittel' | 'mobil';

/**
 * Post chain per preset (KB-I41, post.ts). `msaa` samples of the half-float scene target; `ao` screen-space ground
 * contact AO with `aoSamples` taps at half resolution; `bloom` restrained bloom above the HDR threshold; `ssr`
 * screen-space reflections on still water (KB-I37); `smaa` SMAA 1x after tone mapping (on top of MSAA, for the
 * edges MSAA leaves: alpha-tested crowns, thin bars, specular). Mobil keeps only the tone mapping and the grade.
 */
export interface PostSettings {
  msaa: 0 | 4;
  ao: boolean;
  aoSamples: number;
  bloom: boolean;
  ssr: boolean;
  smaa: boolean;
}

export interface QualitySettings {
  label_de: string;
  dprCap: number;
  shadowMapSize: number;
  post: PostSettings;
}

export const QUALITY: Record<QualityPreset, QualitySettings> = {
  hoch: { label_de: 'Hoch', dprCap: 1.5, shadowMapSize: 4096, post: { msaa: 4, ao: true, aoSamples: 12, bloom: true, ssr: true, smaa: false } },
  mittel: { label_de: 'Mittel', dprCap: 1.25, shadowMapSize: 4096, post: { msaa: 4, ao: true, aoSamples: 8, bloom: true, ssr: true, smaa: false } },
  mobil: { label_de: 'Mobil', dprCap: 1.0, shadowMapSize: 2048, post: { msaa: 4, ao: false, aoSamples: 0, bloom: false, ssr: false, smaa: false } },
};

/** DPR cap for stills (photo mode, capture). */
export const PHOTO_DPR = 2;

export function isPreset(x: unknown): x is QualityPreset {
  return x === 'hoch' || x === 'mittel' || x === 'mobil';
}

/** Effective device pixel ratio: min(device, cap × adaptive scale), but never below min(device, 1). */
export function effectiveDpr(deviceDpr: number, cap: number, scale = 1): number {
  const floor = Math.min(deviceDpr, 1);
  return Math.max(floor, Math.min(deviceDpr, cap * scale));
}

export interface AdaptiveOptions {
  /** frame budget (ms GPU) */
  budgetMs: number;
  /** raise the scale again below this (ms) */
  relaxMs: number;
  /** smoothing factor of the exponential moving average (0…1, per sample) */
  alpha: number;
  /** scale steps */
  step: number;
  minScale: number;
  /** samples to wait after a change before deciding again */
  cooldown: number;
}

export const ADAPTIVE_DEFAULTS: AdaptiveOptions = { budgetMs: 14, relaxMs: 9, alpha: 0.1, step: 0.1, minScale: 0.6, cooldown: 30 };

/** Moving-average frame-time controller with hysteresis and a cooldown; returns the render scale (minScale…1). */
export class AdaptiveScale {
  scale = 1;
  avg = NaN;
  private wait = 0;
  constructor(public opts: AdaptiveOptions = ADAPTIVE_DEFAULTS) {}

  reset(): void {
    this.scale = 1;
    this.avg = NaN;
    this.wait = 0;
  }

  /** Feed one GPU frame time (ms); returns the (possibly changed) scale. Non-finite samples are ignored. */
  update(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) return this.scale;
    const o = this.opts;
    this.avg = Number.isFinite(this.avg) ? this.avg + o.alpha * (ms - this.avg) : ms;
    if (this.wait > 0) {
      this.wait--;
      return this.scale;
    }
    let next = this.scale;
    if (this.avg > o.budgetMs) {
      // cost scales with pixels ≈ scale²: jump straight to the scale that would meet the budget (at least one step)
      const want = this.scale * Math.sqrt(o.budgetMs / this.avg);
      next = Math.max(o.minScale, Math.min(this.scale - o.step, Math.floor(want / o.step) * o.step));
    } else if (this.avg < o.relaxMs && this.scale < 1) {
      next = Math.min(1, this.scale + o.step);
    }
    next = Math.round(next * 100) / 100;
    if (next !== this.scale) {
      this.scale = next;
      this.wait = o.cooldown;
      this.avg = NaN; // the old average was measured at the old resolution
    }
    return this.scale;
  }
}
