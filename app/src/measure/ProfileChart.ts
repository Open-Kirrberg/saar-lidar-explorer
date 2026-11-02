/**
 * Height-profile chart (F17): plain 2D canvas in the Messen card. DGM (DTM) solid with a light
 * fill, DOM (DSM) dashed where available, min/max marks, axes in metres, hover readout. Hover
 * reports the sample index so the tool can show a cursor in 3D.
 */
import { fmtNum } from './model';
import { localSlopeDeg, nearestSample, niceTicks } from './profile';
import type { Profile } from './profile';

const PAD = { l: 40, r: 8, t: 16, b: 18 };
const HEIGHT = 150;
const MIN_RANGE = 2; // m: flat ground is not blown up to full height

export class ProfileChart {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly readout: HTMLElement;
  private profile: Profile | null = null;
  private hover = -1;
  private y0 = 0;
  private y1 = 1;

  constructor(private readonly onHover: (index: number | null) => void) {
    this.root = document.createElement('div');
    this.root.className = 'sle-measure-chart';
    this.root.innerHTML = `<canvas></canvas><div class="sle-measure-readout sle-small sle-dim"></div>`;
    this.canvas = this.root.querySelector('canvas')!;
    this.readout = this.root.querySelector('.sle-measure-readout')!;
    this.canvas.style.height = `${HEIGHT}px`;
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = -1;
      this.onHover(null);
      this.draw();
    });
  }

  set(profile: Profile | null): void {
    this.profile = profile;
    this.hover = -1;
    this.root.hidden = !profile;
    if (profile) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const a of [profile.dtm, profile.dsm]) {
        for (const v of a) {
          if (!Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      const mid = (lo + hi) / 2;
      const half = Math.max((hi - lo) * 0.55, MIN_RANGE / 2);
      this.y0 = mid - half;
      this.y1 = mid + half;
    }
    this.draw();
  }

  private geom() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight || HEIGHT;
    const p = this.profile!;
    const dMax = Math.max(p.d[p.d.length - 1] ?? 1, 1e-6);
    const pw = Math.max(w - PAD.l - PAD.r, 10);
    const ph = Math.max(h - PAD.t - PAD.b, 10);
    return {
      w,
      h,
      pw,
      ph,
      dMax,
      X: (d: number) => PAD.l + (d / dMax) * pw,
      Y: (v: number) => PAD.t + (1 - (v - this.y0) / (this.y1 - this.y0)) * ph,
    };
  }

  private onMove(e: PointerEvent): void {
    const p = this.profile;
    if (!p || p.d.length === 0) return;
    const r = this.canvas.getBoundingClientRect();
    const g = this.geom();
    const t = ((e.clientX - r.left - PAD.l) / g.pw) * g.dMax;
    const i = nearestSample(p.d, Math.min(Math.max(t, 0), g.dMax));
    if (i === this.hover) return;
    this.hover = i;
    this.onHover(i);
    this.draw();
  }

  draw(): void {
    const p = this.profile;
    const c = this.canvas;
    if (!p || c.clientWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const g = this.geom();
    if (c.width !== Math.round(g.w * dpr) || c.height !== Math.round(g.h * dpr)) {
      c.width = Math.round(g.w * dpr);
      c.height = Math.round(g.h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;

    // grid + axis labels
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.fillStyle = 'rgba(235,235,235,0.75)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yt = niceTicks(this.y0, this.y1, 4);
    const ydig = yt.length > 1 && yt[1] - yt[0] < 1 ? 1 : 0;
    for (const v of yt) {
      const y = Math.round(g.Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(g.w - PAD.r, y);
      ctx.stroke();
      ctx.fillText(fmtNum(v, ydig), PAD.l - 4, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xt = niceTicks(0, g.dMax, Math.max(2, Math.floor(g.pw / 60)));
    for (const v of xt) {
      const x = Math.round(g.X(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, g.h - PAD.b);
      ctx.stroke();
      ctx.fillText(`${fmtNum(v, g.dMax < 10 ? 1 : 0)}`, x, g.h - PAD.b + 3);
    }
    ctx.textAlign = 'left';
    ctx.fillText('m', g.w - PAD.r - 8, g.h - PAD.b + 3);

    // DTM fill + line (gaps at NaN)
    const n = p.d.length;
    const path = (arr: Float64Array, close: boolean) => {
      ctx.beginPath();
      let open = false;
      let startX = 0;
      let lastX = 0;
      for (let i = 0; i < n; i++) {
        const v = arr[i];
        if (!Number.isFinite(v)) {
          if (open && close) {
            ctx.lineTo(lastX, g.h - PAD.b);
            ctx.lineTo(startX, g.h - PAD.b);
            ctx.closePath();
          }
          open = false;
          continue;
        }
        const x = g.X(p.d[i]);
        const y = g.Y(v);
        if (!open) {
          ctx.moveTo(x, y);
          startX = x;
          open = true;
        } else ctx.lineTo(x, y);
        lastX = x;
      }
      if (open && close) {
        ctx.lineTo(lastX, g.h - PAD.b);
        ctx.lineTo(startX, g.h - PAD.b);
        ctx.closePath();
      }
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, g.pw, g.ph);
    ctx.clip();
    path(p.dtm, true);
    ctx.fillStyle = 'rgba(120,170,255,0.20)';
    ctx.fill();
    if (p.dsmCount > 0) {
      path(p.dsm, false);
      ctx.strokeStyle = '#7ed17e';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    path(p.dtm, false);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // min / max marks
    let iMin = -1;
    let iMax = -1;
    for (let i = 0; i < n; i++) {
      const v = p.dtm[i];
      if (!Number.isFinite(v)) continue;
      if (iMin < 0 || v < p.dtm[iMin]) iMin = i;
      if (iMax < 0 || v > p.dtm[iMax]) iMax = i;
    }
    for (const [i, col] of [
      [iMin, '#4aa3ff'],
      [iMax, '#ff7a59'],
    ] as const) {
      if (i < 0) continue;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(g.X(p.d[i]), g.Y(p.dtm[i]), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // hover
    if (this.hover >= 0 && this.hover < n) {
      const x = Math.round(g.X(p.d[this.hover])) + 0.5;
      ctx.strokeStyle = 'rgba(255,225,74,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, g.h - PAD.b);
      ctx.stroke();
      const v = p.dtm[this.hover];
      if (Number.isFinite(v)) {
        ctx.fillStyle = '#ffe14a';
        ctx.beginPath();
        ctx.arc(x, g.Y(v), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // legend + chart exaggeration (vertical px/m ÷ horizontal px/m)
    const vex = g.ph / (this.y1 - this.y0) / (g.pw / g.dMax);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0f0f0';
    ctx.fillText('— DGM', PAD.l + 2, 2);
    if (p.dsmCount > 0) {
      ctx.fillStyle = '#7ed17e';
      ctx.fillText('- - DOM', PAD.l + 46, 2);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(235,235,235,0.6)';
    ctx.fillText(`Überhöhung ×${fmtNum(vex, vex < 10 ? 1 : 0)}`, g.w - PAD.r, 2);

    this.readout.textContent = this.readoutText();
  }

  private readoutText(): string {
    const p = this.profile;
    const i = this.hover;
    if (!p || i < 0 || i >= p.d.length) return 'Maus über das Profil: Höhe und Neigung an der Stelle';
    const s = localSlopeDeg(p.d, p.dtm, i);
    const dsm = p.dsm[i];
    return (
      `${fmtNum(p.d[i], 1)} m · DGM ${fmtNum(p.dtm[i], 2)} m` +
      (Number.isFinite(dsm) ? ` · DOM ${fmtNum(dsm, 2)} m` : '') +
      ` · Neigung ${fmtNum(s, 1)}°`
    );
  }
}
