/**
 * Wave-6 interior residuals (wave-5 review: "chimneypieces are plain white boxes with box andirons", "the Antichambre
 * stove reads as a snowman"): a Louis-seize cheminée à la française and a faience column stove, built into the room
 * buckets by fixtures.ts. Local fixture frame: X along the wall, Y up, Z out of the wall (front +Z), origin on the floor
 * at the centre of the piece's footprint. Sizes and colours from grammar HEARTH [N research/09 §4.2].
 */
import * as THREE from 'three';
import { HEARTH } from '../layout/grammar.ts';
import { type Bucket, type V3, T, cyl } from './mesh.ts';

export interface HearthKit {
  /** Body / inlay marble buckets (veined), soot, iron, gilt-bronze, a tinted bucket by colour. */
  marble: (body: string, vein: string) => Bucket;
  tint: (colour: string) => Bucket;
  iron: Bucket;
  gilt: Bucket;
  /** Box in the fixture frame. */
  box: (b: Bucket, min: V3, max: V3, skip?: string[]) => void;
  /** Geometry in the fixture frame. */
  geo: (b: Bucket, g: THREE.BufferGeometry, local: THREE.Matrix4) => void;
}

const lathe = (pts: [number, number][], seg: number) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

/**
 * Side profile [depth, height] of a console jamb (front of the jamb face = depth 0): a foot block, a concave waist, a
 * swelling belly and a volute block under the frieze [N Louis-seize console jamb].
 */
export function consoleProfile(y0: number, y1: number, proj: number): [number, number][] {
  const H = y1 - y0;
  const pts: [number, number][] = [[0, y0], [proj * 0.6, y0], [proj * 0.6, y0 + 0.05]];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // waist at 30 % of the height, then a belly swelling to the full projection under the volute block
    const p = t < 0.3 ? proj * (0.6 - t) : proj * (0.3 + 0.7 * Math.pow((t - 0.3) / 0.7, 1.5));
    pts.push([Math.max(proj * 0.25, p), y0 + 0.05 + (H - 0.11) * t]);
  }
  pts.push([proj, y1 - 0.06], [proj * 1.08, y1 - 0.06], [proj * 1.08, y1], [0, y1]);
  return pts;
}

/** Extrude a [depth, height] profile across x ∈ [x0, x1], standing on the face plane z = zf (proper winding). */
function extrudeProfile(k: HearthKit, b: Bucket, prof: [number, number][], x0: number, x1: number, zf: number): void {
  const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 4 });
  // shape (x = depth, y = height), extrude z -> fixture (-x): a proper rotation (det +1)
  const m = new THREE.Matrix4().set(0, 0, -1, x1, 0, 1, 0, 0, 1, 0, 0, zf, 0, 0, 0, 1);
  k.geo(b, g, m);
}

/**
 * Cheminée à la française: hearth slab, soot-dark opening with a cast-iron fireback (arched, raised border, oval
 * relief), console jambs, a frieze with fluted inlay fields, a centre tablet with a gilt-bronze garland and corner
 * paterae, a moulded shelf, and two gilt-bronze chenets (plinth on toupie feet, urn, iron log bar) with laid logs.
 */
export function chimneypiece(k: HearthKit, w: number, d: number, h: number, state: boolean): void {
  const pal = state ? HEARTH.marble.state : HEARTH.marble.private;
  const mb = k.marble(pal.body, pal.vein);
  const inl = k.marble(pal.inlay, pal.inlayVein);
  const soot = k.tint('#2b2622');
  const zb = -d / 2;
  const zf = d / 2;
  const ow = Math.min(1.25, w - 0.5);
  const oh = Math.min(0.92, h - 0.24);
  const jx = ow / 2;
  const shelf = h;
  // hearth slab (inlay marble in front of the opening)
  k.box(mb, [-w / 2 - 0.12, 0, zb], [w / 2 + 0.12, 0.03, zf + 0.42], ['-y']);
  k.box(inl, [-jx, 0.03, zf - 0.02], [jx, 0.035, zf + 0.36], ['-y']);
  // opening: back, cheeks, soffit
  k.box(soot, [-jx, 0.03, zb], [jx, oh, zb + 0.04], ['-y']);
  for (const sx of [-1, 1]) k.box(soot, [sx > 0 ? jx - 0.03 : -jx, 0.03, zb], [sx > 0 ? jx : -jx + 0.03, oh, zf - 0.06], ['-y']);
  k.box(soot, [-jx, oh - 0.03, zb], [jx, oh, zf - 0.06]);
  // jambs: plinth block, flat pilaster, inlaid panel on the inner return and a console on the face
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? jx : -w / 2;
    const x1 = sx > 0 ? w / 2 : -jx;
    const cw = x1 - x0;
    k.box(mb, [x0, 0.03, zb], [x1, 0.15, zf + 0.02], ['-y', '-z']);
    k.box(mb, [x0 + 0.01, 0.15, zb], [x1 - 0.01, oh, zf - 0.03], ['-y', '-z']);
    // inlay field on the jamb face beside the console
    const inner = sx > 0 ? x0 + 0.03 : x1 - 0.03;
    k.box(inl, [Math.min(inner, inner - sx * 0.05), 0.22, zf - 0.03], [Math.max(inner, inner - sx * 0.05), oh - 0.08, zf - 0.024]);
    const ca = x0 + cw * 0.3;
    const cb = x1 - cw * 0.12;
    const [a, b] = sx > 0 ? [ca, cb] : [x0 + cw * 0.12, x1 - cw * 0.3];
    extrudeProfile(k, mb, consoleProfile(0.15, oh, 0.1), a, b, zf - 0.03);
    // volute: a scroll on each face of the console head, a gilt rosette on its eye
    for (const xx of [a, b]) {
      k.geo(mb, cyl(0.055, 0.055, 0.02, 14), T(xx + (xx === a ? -0.008 : 0.008), oh - 0.07, zf + 0.03).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      k.geo(k.gilt, cyl(0.018, 0.018, 0.022, 10), T(xx + (xx === a ? -0.01 : 0.01), oh - 0.07, zf + 0.03).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
    }
    // acanthus leaf down the console belly (gilt-bronze in state rooms, carved in private ones)
    k.geo(state ? k.gilt : mb, new THREE.SphereGeometry(1, 6, 4), T((a + b) / 2, oh - 0.2, zf + 0.07).multiply(new THREE.Matrix4().makeScale((b - a) * 0.32, 0.09, 0.018)));
  }
  // frieze: body, fluted inlay fields left and right, centre tablet with a gilt garland, corner blocks with paterae
  const fy0 = oh;
  const fy1 = shelf - 0.09;
  k.box(mb, [-w / 2 - 0.01, fy0, zb], [w / 2 + 0.01, fy1, zf - 0.01], ['-z']);
  const tab = Math.min(0.26, ow * 0.2);
  for (const sx of [-1, 1]) {
    const xa = sx > 0 ? tab + 0.03 : -jx + 0.02;
    const xb = sx > 0 ? jx - 0.02 : -tab - 0.03;
    k.box(inl, [xa, fy0 + 0.03, zf - 0.01], [xb, fy1 - 0.03, zf - 0.004]);
    // wave 11 (budget): the 6 mm flutes keep their front and side faces only
    for (let x = xa + 0.035; x < xb - 0.02; x += 0.05) k.box(mb, [x - 0.008, fy0 + 0.04, zf - 0.004], [x + 0.008, fy1 - 0.04, zf + 0.002], ['-z', '-y', '+y']);
    k.box(mb, [sx > 0 ? jx + 0.005 : -w / 2 - 0.01, fy0, zf - 0.01], [sx > 0 ? w / 2 + 0.01 : -jx - 0.005, fy1, zf + 0.03], ['-z']);
    const px = sx * (jx + (w / 2 - jx) / 2);
    k.geo(k.gilt, cyl(0.04, 0.04, 0.012, 14), T(px, (fy0 + fy1) / 2, zf + 0.036).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    k.geo(k.gilt, new THREE.TorusGeometry(0.048, 0.008, 4, 16), T(px, (fy0 + fy1) / 2, zf + 0.035));
  }
  k.box(mb, [-tab, fy0 + 0.015, zf - 0.01], [tab, fy1 - 0.015, zf + 0.02], ['-z']);
  // gilt-bronze garland (festoon) on the tablet, tied with a bow
  k.geo(k.gilt, new THREE.TorusGeometry(tab * 0.62, 0.012, 5, 14, Math.PI), T(0, fy1 - 0.035, zf + 0.026).multiply(new THREE.Matrix4().makeRotationZ(Math.PI)).multiply(new THREE.Matrix4().makeScale(1, 0.55, 1)));
  for (const sx of [-1, 1]) k.geo(k.gilt, new THREE.SphereGeometry(0.018, 6, 4), T(sx * tab * 0.62, fy1 - 0.035, zf + 0.026));
  k.geo(k.gilt, new THREE.SphereGeometry(1, 6, 4), T(0, fy1 - 0.03, zf + 0.026).multiply(new THREE.Matrix4().makeScale(0.03, 0.016, 0.01)));
  // shelf: fillet, cavetto and the slab with a rounded nose, returning at both ends
  const sh0 = fy1;
  const prof: [number, number][] = [[0, sh0], [0.03, sh0], [0.03, sh0 + 0.015], [0.045, sh0 + 0.025], [0.062, sh0 + 0.04], [0.07, sh0 + 0.055], [0.09, sh0 + 0.058], [0.1, sh0 + 0.07], [0.098, shelf - 0.012], [0.09, shelf], [0, shelf]];
  extrudeProfile(k, mb, prof, -w / 2 - 0.08, w / 2 + 0.08, zf - 0.01);
  k.box(mb, [-w / 2 - 0.08, sh0 + 0.04, zb], [w / 2 + 0.08, shelf, zf - 0.01], ['-z']);
  // cast-iron fireback: arched plaque, raised border, oval relief with a crown
  const fb = Math.min(0.4, jx - 0.07);
  const iron = k.iron;
  k.box(iron, [-fb, 0.03, zb + 0.04], [fb, 0.46, zb + 0.065]);
  k.geo(iron, new THREE.CylinderGeometry(fb, fb, 0.025, 16, 1, false, -Math.PI / 2, Math.PI), T(0, 0.46, zb + 0.0525).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  for (const sx of [-1, 1]) k.box(iron, [sx * fb - (sx > 0 ? 0.025 : 0), 0.03, zb + 0.065], [sx * fb + (sx < 0 ? 0.025 : 0), 0.46, zb + 0.078]);
  k.geo(iron, new THREE.TorusGeometry(fb - 0.012, 0.012, 4, 14, Math.PI), T(0, 0.46, zb + 0.072));
  k.geo(iron, new THREE.SphereGeometry(1, 10, 5), T(0, 0.36, zb + 0.07).multiply(new THREE.Matrix4().makeScale(0.11, 0.14, 0.015)));
  k.geo(iron, cyl(0.05, 0.06, 0.05, 6), T(0, 0.53, zb + 0.07));
  // chenets: gilt-bronze plinth on toupie feet with an urn and a flame finial; an iron log bar back to a rear foot
  for (const sx of [-1, 1]) {
    const x = sx * Math.min(jx - 0.14, 0.36);
    const zc = zf + 0.02;
    k.box(k.gilt, [x - 0.11, 0.05, zc - 0.045], [x + 0.11, 0.1, zc + 0.045]);
    k.box(k.gilt, [x - 0.12, 0.1, zc - 0.05], [x + 0.12, 0.115, zc + 0.05]);
    for (const fx of [-0.085, 0.085]) k.geo(k.gilt, new THREE.SphereGeometry(1, 6, 4), T(x + fx, 0.04, zc).multiply(new THREE.Matrix4().makeScale(0.03, 0.025, 0.03)));
    k.geo(k.gilt, lathe([[0.001, 0], [0.035, 0], [0.025, 0.02], [0.05, 0.07], [0.055, 0.1], [0.035, 0.14], [0.02, 0.15], [0.03, 0.16], [0.001, 0.2]], 12), T(x, 0.115, zc));
    k.geo(k.gilt, cyl(0.012, 0, 0.06, 6), T(x, 0.345, zc));
    const bx = x - sx * 0.04;
    k.box(iron, [bx - 0.014, 0.07, zb + 0.12], [bx + 0.014, 0.1, zc - 0.04]);
    k.box(iron, [bx - 0.014, 0.03, zb + 0.12], [bx + 0.014, 0.1, zb + 0.15]);
  }
  const log = k.tint('#5a3a22');
  k.geo(log, cyl(0.06, 0.06, 0.8, 8), T(0, 0.15, zb + 0.24).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  k.geo(log, cyl(0.05, 0.05, 0.7, 8), T(0.02, 0.24, zb + 0.2).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 - 0.06)));
}

/**
 * Fluted 2D section for the stove column: `n` flutes as shallow concave scallops between fillets [N].
 */
export function flutedSection(r: number, n: number, depth: number, seg = 4): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const fillet = (a1 - a0) * 0.18;
    pts.push([Math.cos(a0) * r, Math.sin(a0) * r]);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const a = a0 + fillet + (a1 - a0 - 2 * fillet) * t;
      const rr = r - depth * Math.sin(Math.PI * t);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  }
  return pts;
}

/**
 * Poêle en faïence: a slab, a tiled fire box on four brass feet with a blue-grey band and cornice, a fluted tiled
 * column with brass rings at foot and head, a round cornice with a blue-grey frieze, and a low gadrooned urn with a
 * brass finial. Tile joints are drawn as fine grey lines. Height `h` ≥ 2 m.
 */
export function faienceStove(k: HearthKit, w: number, d: number, h: number): void {
  const F = HEARTH.faience;
  const fa = k.tint(F.glaze);
  const joint = k.tint(F.joint);
  const band = k.tint(F.band);
  const brass = k.tint(F.brass);
  const stone = k.tint('#8E8B85');
  const hw = w / 2;
  const hd = d / 2;
  const H = Math.max(2.0, h);
  // slab and brass feet
  k.box(stone, [-hw - 0.05, 0, -hd - 0.03], [hw + 0.05, 0.05, hd + 0.05], ['-y']);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.geo(brass, cyl(0.035, 0.05, 0.12, 8), T(sx * (hw - 0.08), 0.11, sz * (hd - 0.08)));
  // fire box
  const y0 = 0.17;
  const y1 = Math.min(0.95, H * 0.34);
  k.box(band, [-hw - 0.015, y0, -hd], [hw + 0.015, y0 + 0.06, hd + 0.015], ['-z']);
  k.box(fa, [-hw, y0 + 0.06, -hd], [hw, y1 - 0.06, hd], ['-z']);
  k.box(band, [-hw - 0.015, y1 - 0.06, -hd], [hw + 0.015, y1, hd + 0.015], ['-z']);
  // tile joints on the three visible faces
  const t = F.tile;
  const jt = 0.004;
  for (let x = -hw + t; x < hw - 0.05; x += t) k.box(joint, [x - jt, y0 + 0.06, hd], [x + jt, y1 - 0.06, hd + 0.002]);
  for (let y = y0 + 0.06 + t; y < y1 - 0.08; y += t) {
    k.box(joint, [-hw, y - jt, hd], [hw, y + jt, hd + 0.002]);
    for (const sx of [-1, 1]) k.box(joint, [sx > 0 ? hw : -hw - 0.002, y - jt, -hd], [sx > 0 ? hw + 0.002 : -hw, y + jt, hd]);
  }
  for (const sx of [-1, 1]) for (let z = -hd + t; z < hd - 0.05; z += t) k.box(joint, [sx > 0 ? hw : -hw - 0.002, y0 + 0.06, z - jt], [sx > 0 ? hw + 0.002 : -hw, y1 - 0.06, z + jt]);
  // brass rosette vent on the front (the stove is fired from the corridor behind [N])
  k.geo(brass, cyl(0.07, 0.07, 0.015, 14), T(0, (y0 + y1) / 2, hd + 0.008).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  k.geo(brass, new THREE.TorusGeometry(0.085, 0.008, 4, 16), T(0, (y0 + y1) / 2, hd + 0.01));
  // cornice of the fire box
  k.box(fa, [-hw - 0.04, y1, -hd], [hw + 0.04, y1 + 0.04, hd + 0.04], ['-z']);
  k.box(fa, [-hw - 0.07, y1 + 0.04, -hd], [hw + 0.07, y1 + 0.08, hd + 0.07], ['-z']);
  // column: base mouldings, fluted shaft, brass rings, capital
  const r = Math.min(hw, hd) - 0.06;
  const c0 = y1 + 0.08;
  k.geo(fa, lathe([[0.001, 0], [r + 0.06, 0], [r + 0.06, 0.04], [r + 0.03, 0.07], [r + 0.04, 0.1], [r + 0.005, 0.13], [0.001, 0.13]], 24), T(0, c0, 0));
  const s0 = c0 + 0.13;
  const top = H - 0.53; // urn + finial (0.53 m) end at H
  const s1 = top - 0.2;
  const shaft = new THREE.ExtrudeGeometry(new THREE.Shape(flutedSection(r, F.flutes, 0.022).map(([x, y]) => new THREE.Vector2(x, y))), { depth: s1 - s0, bevelEnabled: false, curveSegments: 2 });
  k.geo(fa, shaft, T(0, s0, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
  for (const y of [s0 + 0.02, s1 - 0.02]) k.geo(brass, new THREE.TorusGeometry(r + 0.004, 0.012, 4, 28), T(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  // wave 11 (budget): the course joints as thin open bands proud of the flutes instead of 32 × 3 tori [I]
  for (let y = s0 + t; y < s1 - 0.1; y += t) k.geo(joint, new THREE.CylinderGeometry(r + 0.001, r + 0.001, 0.007, 24, 1, true), T(0, y, 0));
  k.geo(fa, lathe([[0.001, 0], [r, 0], [r + 0.02, 0.03], [r + 0.015, 0.06], [r + 0.07, 0.17], [r + 0.09, 0.2], [0.001, 0.2]], 24), T(0, s1, 0));
  // entablature: a blue-grey frieze band and a projecting cornice
  k.geo(band, cyl(r + 0.08, r + 0.08, 0.1, 24), T(0, top + 0.05, 0));
  k.geo(fa, lathe([[0.001, 0], [r + 0.09, 0], [r + 0.12, 0.03], [r + 0.15, 0.05], [r + 0.15, 0.08], [0.001, 0.08]], 24), T(0, top + 0.1, 0));
  // low gadrooned urn with a lid and a brass pine-cone finial
  const u0 = top + 0.18;
  k.geo(fa, lathe([[0.001, 0], [0.1, 0], [0.1, 0.025], [0.06, 0.045], [0.08, 0.07], [0.19, 0.12], [0.21, 0.16], [0.17, 0.2], [0.11, 0.215], [0.001, 0.215]], 16), T(0, u0, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.geo(fa, new THREE.SphereGeometry(1, 5, 3), T(Math.sin(a) * 0.17, u0 + 0.12, Math.cos(a) * 0.17).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeScale(0.025, 0.05, 0.02)));
  }
  k.geo(brass, new THREE.TorusGeometry(0.2, 0.008, 4, 20), T(0, u0 + 0.16, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  k.geo(brass, lathe([[0.001, 0], [0.035, 0.01], [0.045, 0.05], [0.03, 0.1], [0.001, 0.13]], 10), T(0, u0 + 0.215, 0));
}
