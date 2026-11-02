/**
 * Photo mode (backlog KB-I47): an accumulated still at 2–3× the CSS resolution with optional mild depth of field and
 * the attribution and "Rekonstruktion – Hypothese" label burned in, saved as PNG. The sample plan and the projection
 * maths are pure (photoMath.ts); this file renders.
 *
 * Per sample the scene is drawn through the post chain (KB-I41: AO, bloom, tone mapping and grade, no MSAA / SMAA) into
 * the (enlarged) drawing buffer with the camera jittered by a sub-pixel Halton
 * offset (and, with DOF, moved on the lens disc with the frustum sheared about the focus plane), copied into a
 * texture and added, sRGB-decoded and weighted 1/n, into a float accumulation target. Averaging after tone mapping
 * is the usual "resolve in display space": edges between the bright sky and dark roofs stay smooth. One sample per
 * task, so the page stays responsive (the main loop pauses its own frames while a still is being exposed). Nothing
 * here runs unless a still is requested: the normal render path is unchanged.
 */
import * as THREE from 'three';
import { type PhotoOptions, burnInText, photoAperture, lensOffset, photoSize, pixelJitter, sampleCount, shiftProjection } from './photoMath.ts';

export interface PhotoHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Run one ordinary frame at the normal scale (LOD, exposure, shadow map). */
  prepare(): void;
  /** Distance (m) to the surface at the screen centre, for the focus plane. */
  focus(): number;
  /** Pause / resume the viewer's own frames and restore its render scale afterwards. */
  setBusy(on: boolean): void;
  restoreScale(): void;
  /** Draw one frame of the scene into the drawing buffer (the post chain, KB-I41). */
  render(): void;
  /** Stills on / off: the post chain then skips MSAA and SMAA (the jittered accumulation antialiases). */
  setStill(on: boolean): void;
  hour(): number;
  attribution: string;
}

export interface PhotoResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  samples: number;
  focus: number;
  aperture: number;
  ms: number;
}

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/** Adds the sRGB-decoded frame × weight (additive blending into the float target). */
const ACCUM_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform float uW;
varying vec2 vUv;
vec3 dec( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }
void main() {
  gl_FragColor = vec4( dec( texture2D( tSrc, vUv ).rgb ) * uW, uW );
}`;

/** Re-encodes the averaged frame to sRGB for the drawing buffer. */
const RESOLVE_FS = /* glsl */ `
uniform sampler2D tAcc;
varying vec2 vUv;
vec3 enc( vec3 c ) { c = clamp( c, 0.0, 1.0 ); return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
void main() {
  gl_FragColor = vec4( enc( texture2D( tAcc, vUv ).rgb ), 1.0 );
}`;

/** Wait for the next animation frame, or 40 ms in a hidden tab (rAF paused there). */
function nextTick(): Promise<void> {
  return new Promise((r) => {
    let done = false;
    const f = () => {
      if (done) return;
      done = true;
      r();
    };
    requestAnimationFrame(f);
    setTimeout(f, 40);
  });
}

/** Burn the label (top left) and the attribution band (bottom) into the still. */
export function burnIn(ctx: CanvasRenderingContext2D, w: number, h: number, hour: number, attribution: string): void {
  const t = burnInText(hour, attribution);
  const u = Math.max(1, h / 1080);
  ctx.save();
  // bottom band: a soft dark gradient so the small type stays legible over sand or sky
  const band = Math.round(46 * u);
  const g = ctx.createLinearGradient(0, h - band * 1.6, 0, h);
  g.addColorStop(0, 'rgba(12,14,17,0)');
  g.addColorStop(1, 'rgba(12,14,17,0.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h - band * 1.6, w, band * 1.6);
  const gt = ctx.createLinearGradient(0, 0, 0, band * 2.2);
  gt.addColorStop(0, 'rgba(12,14,17,0.5)');
  gt.addColorStop(1, 'rgba(12,14,17,0)');
  ctx.fillStyle = gt;
  ctx.fillRect(0, 0, w, band * 2.2);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 3 * u;
  ctx.fillStyle = 'rgba(244,240,232,0.92)';
  ctx.font = `${Math.round(12.5 * u)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
  const pad = Math.round(18 * u);
  // shrink the attribution to one line
  let size = 12.5 * u;
  while (ctx.measureText(t.attribution).width > w - 2 * pad && size > 7 * u) {
    size -= 0.5 * u;
    ctx.font = `${Math.round(size)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
  }
  ctx.fillText(t.attribution, pad, h - Math.round(14 * u));
  // label, top left
  ctx.font = `600 ${Math.round(22 * u)}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = 'rgba(248,244,236,0.95)';
  ctx.fillText(t.label, pad, pad + Math.round(22 * u));
  ctx.font = `${Math.round(12.5 * u)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(231,194,122,0.95)';
  ctx.fillText(t.sub, pad, pad + Math.round(44 * u));
  ctx.restore();
}

let busy = false;

/** True while a still is being exposed. */
export function photoBusy(): boolean {
  return busy;
}

/**
 * Expose one still. Resolves with a canvas holding the final image (burned-in text included); the caller encodes and
 * downloads it. `onProgress(k, n)` reports the samples.
 */
export async function takePhoto(host: PhotoHost, opts: PhotoOptions, onProgress?: (k: number, n: number) => void): Promise<PhotoResult> {
  if (busy) throw new Error('photo already running');
  busy = true;
  const t0 = performance.now();
  const { renderer, camera } = host;
  const gl = renderer.getContext();
  const maxSide = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  const n = sampleCount(opts);
  const disposables: { dispose(): void }[] = [];
  const proj0 = camera.projectionMatrix.clone();
  const projInv0 = camera.projectionMatrixInverse.clone();
  const pos0 = camera.position.clone();
  const clear = { c: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha(), auto: renderer.autoClear };
  host.setBusy(true);
  host.setStill(true);
  try {
    host.prepare();
    const focus = opts.dof ? Math.max(1, host.focus()) : Infinity;
    const size = photoSize(innerWidth, innerHeight, opts.scale, maxSide);
    renderer.setPixelRatio(size.scale);
    renderer.setSize(innerWidth, innerHeight, false);
    const bw = renderer.domElement.width;
    const bh = renderer.domElement.height;
    // wave-7 review: far focus (wide shots) keeps the foreground sharp (photoMath.ts PHOTO_DOF)
    const aperture = opts.dof ? photoAperture(focus, proj0.elements[0], bw) : 0;

    const frameTex = new THREE.FramebufferTexture(bw, bh);
    const floatBlend = renderer.extensions.has('EXT_float_blend');
    const accum = new THREE.WebGLRenderTarget(bw, bh, { type: floatBlend ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const accumMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: frameTex }, uW: { value: 1 / n } },
      vertexShader: QUAD_VS,
      fragmentShader: ACCUM_FS,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
    });
    const resolveMat = new THREE.ShaderMaterial({ uniforms: { tAcc: { value: accum.texture } }, vertexShader: QUAD_VS, fragmentShader: RESOLVE_FS, depthTest: false, depthWrite: false, toneMapped: false });
    const quad = new THREE.Mesh(quadGeo, accumMat);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    disposables.push(frameTex, accum, quadGeo, accumMat, resolveMat);

    renderer.setRenderTarget(accum);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear.c, clear.a);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    for (let k = 0; k < n; k++) {
      const [jx, jy] = pixelJitter(k);
      const [ax, ay] = lensOffset(k, n, aperture);
      camera.position.copy(pos0).addScaledVector(right, ax).addScaledVector(up, ay);
      camera.updateMatrixWorld();
      camera.projectionMatrix.copy(proj0);
      shiftProjection(camera.projectionMatrix.elements, jx, jy, bw, bh, ax, ay, focus);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.setRenderTarget(null);
      renderer.autoClear = clear.auto;
      host.render();
      renderer.copyFramebufferToTexture(frameTex);
      renderer.setRenderTarget(accum);
      renderer.autoClear = false;
      quad.material = accumMat;
      renderer.render(quadScene, quadCam);
      renderer.setRenderTarget(null);
      renderer.autoClear = clear.auto;
      onProgress?.(k + 1, n);
      if (k < n - 1) await nextTick();
    }
    camera.position.copy(pos0);
    camera.updateMatrixWorld();
    camera.projectionMatrix.copy(proj0);
    camera.projectionMatrixInverse.copy(projInv0);

    // resolve into the drawing buffer and copy it out in the same task (no preserveDrawingBuffer needed)
    quad.material = resolveMat;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
    const out = document.createElement('canvas');
    out.width = bw;
    out.height = bh;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(renderer.domElement, 0, 0);
    burnIn(ctx, bw, bh, host.hour(), host.attribution);
    return { canvas: out, width: bw, height: bh, samples: n, focus, aperture, ms: performance.now() - t0 };
  } finally {
    camera.position.copy(pos0);
    camera.projectionMatrix.copy(proj0);
    camera.projectionMatrixInverse.copy(projInv0);
    camera.updateMatrixWorld();
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear.c, clear.a);
    renderer.autoClear = clear.auto;
    for (const d of disposables) d.dispose();
    host.setStill(false);
    host.restoreScale();
    host.setBusy(false);
    busy = false;
  }
}

/** Encode a canvas as PNG and offer it as a download. */
export async function downloadPng(canvas: HTMLCanvasElement, name: string): Promise<number> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return blob.size;
}
