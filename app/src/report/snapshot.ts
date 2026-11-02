/**
 * F18: capture the current 3D view as an image for the report, with ONLY the report's marker drawn
 * on top. Other markers, POIs and labels are DOM overlays (Labels3D) and never reach the WebGL
 * canvas; the F15 candidate group (name 'Candidates') and scene objects flagged
 * `userData.reportHide = true` are hidden
 * for the capture, and `sle:report-capture` events (detail.phase 'begin' | 'end') let features
 * switch off anything else that must not appear.
 */
import { Ray, Vector2, Vector3 } from 'three';
import type { Object3D } from 'three';
import { utmToWorld } from '../geo';
import type { AppContext } from '../main';

export interface Snapshot3D {
  image: string;
  width: number;
  height: number;
  /** Marker inside the view frustum (drawn on the image). */
  markerInView: boolean;
  /** Marker hidden behind terrain from this camera (drawn hollow). */
  markerOccluded: boolean;
  /** Camera distance to the marker (m, displayed space). */
  distance: number;
}

export interface SnapshotOptions {
  width?: number;
  height?: number;
  quality?: number;
  label?: string;
}

export const REPORT_CAPTURE_EVENT = 'sle:report-capture';

/**
 * Scene objects that must never appear in a report: F15 candidates (group 'Candidates'), F17
 * measurements ('MeasureOverlay') + opt-in flag `userData.reportHide`.
 */
export function isReportHidden(o: Pick<Object3D, 'name' | 'userData'>): boolean {
  return o.userData?.reportHide === true || /^candidates?\b/i.test(o.name) || o.name === 'MeasureOverlay';
}

export function captureView(ctx: AppContext, E: number, N: number, h: number | null, opts: SnapshotOptions = {}): Snapshot3D {
  const { renderer, camera, scene, terrain, manifest } = ctx;
  const width = opts.width ?? 1600;
  const height = opts.height ?? 1000;
  const prevSize = renderer.getSize(new Vector2());
  const prevRatio = renderer.getPixelRatio();
  const prevAspect = camera.aspect;

  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (isReportHidden(o) && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  window.dispatchEvent(new CustomEvent(REPORT_CAPTURE_EVENT, { detail: { phase: 'begin' } }));

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const g = out.getContext('2d')!;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    terrain.update(camera);
    renderer.render(scene, camera);
    // Same task as render(): the drawing buffer is still intact without preserveDrawingBuffer.
    g.drawImage(renderer.domElement, 0, 0, width, height);
  } finally {
    for (const o of hidden) o.visible = true;
    window.dispatchEvent(new CustomEvent(REPORT_CAPTURE_EVENT, { detail: { phase: 'end' } }));
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    terrain.update(camera);
    renderer.render(scene, camera);
  }

  // Marker position in the displayed (exaggerated) world.
  const w = utmToWorld(E, N, manifest.origin);
  const trueH = h ?? terrain.heightAt(w.x, w.z);
  const y = Number.isFinite(trueH) ? terrain.toDisplayY(trueH) : terrain.surfaceY(w.x, w.z);
  const p = new Vector3(w.x, Number.isFinite(y) ? y : 0, w.z);
  const distance = camera.position.distanceTo(p);
  const ndc = p.clone().project(camera);
  const inView = Number.isFinite(y) && ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
  let occluded = false;
  if (inView) {
    // Test a point slightly above the ground (≈ the pin's foot) so micro-relief at grazing angles
    // does not count as occlusion; exaggeration scales that lift like everything else in 3D.
    const exag = terrain.uniforms.uExag.value;
    const q = p.clone();
    q.y += 1.5 * Math.max(exag, 1) + 0.5;
    const dq = camera.position.distanceTo(q);
    const hit = terrain.intersectRay(new Ray(camera.position.clone(), q.clone().sub(camera.position).normalize()));
    occluded = !!hit && hit.distanceTo(camera.position) < dq - Math.max(2, dq * 0.005);
    drawPin(g, ((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height, opts.label ?? '', occluded);
  }
  return { image: out.toDataURL('image/jpeg', opts.quality ?? 0.9), width, height, markerInView: inView, markerOccluded: occluded, distance };
}

/** Pin: ring at the ground point, stem, label box above (only the report's marker). */
export function drawPin(g: CanvasRenderingContext2D, x: number, y: number, label: string, hollow = false): void {
  const stem = 46;
  g.save();
  g.lineWidth = 3;
  g.strokeStyle = '#fff';
  g.fillStyle = '#e4572e';
  g.beginPath();
  g.arc(x, y, 9, 0, Math.PI * 2);
  if (!hollow) g.fill();
  g.stroke();
  g.beginPath();
  g.arc(x, y, 9, 0, Math.PI * 2);
  g.strokeStyle = '#e4572e';
  g.lineWidth = 1.5;
  g.stroke();
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.setLineDash(hollow ? [5, 4] : []);
  g.beginPath();
  g.moveTo(x, y - 10);
  g.lineTo(x, y - stem);
  g.stroke();
  g.setLineDash([]);
  if (label) {
    g.font = '600 20px "Helvetica Neue", Arial, sans-serif';
    const t = label.length > 48 ? `${label.slice(0, 47)}…` : label;
    const tw = g.measureText(t).width;
    const bx = Math.max(4, Math.min(g.canvas.width - tw - 20, x - tw / 2 - 8));
    const by = Math.max(4, y - stem - 32);
    g.fillStyle = 'rgba(20,24,28,0.82)';
    g.fillRect(bx, by, tw + 16, 30);
    g.strokeStyle = '#e4572e';
    g.lineWidth = 2;
    g.strokeRect(bx, by, tw + 16, 30);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(t, bx + 8, by + 15);
  }
  g.restore();
}
