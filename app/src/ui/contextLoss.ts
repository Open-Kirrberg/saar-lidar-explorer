/**
 * F20: WebGL context loss (phones drop the GPU context when the app is backgrounded or memory runs
 * low). Instead of a frozen/black canvas we show "Grafik wird neu geladen …", allow the browser to
 * restore the context (preventDefault) and then reload the page — the URL hash keeps the camera
 * pose and the look, and a reload rebuilds every terrain/data texture reliably (re-uploading all
 * R32F height textures in place would need every module to keep its CPU copies).
 * If the context doesn't come back within a few seconds, a "Neu laden" button is offered.
 */

const ID = 'sle-glctx';

export interface ContextLossOptions {
  /** Called right before reloading (e.g. to flush the hash). */
  beforeReload?: () => void;
  /** ms to wait for `webglcontextrestored` before offering the manual button. */
  restoreTimeoutMs?: number;
  reload?: () => void;
}

export function watchContextLoss(canvas: HTMLCanvasElement, o: ContextLossOptions = {}): () => void {
  const reload = o.reload ?? (() => location.reload());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const overlay = (withButton: boolean) => {
    let el = document.getElementById(ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      el.setAttribute('role', 'alert');
      (document.querySelector('#app') ?? document.body).appendChild(el);
    }
    el.innerHTML = `<div class="sle-glctx-box"><p>Grafik wird neu geladen …</p>${
      withButton ? '<p class="sle-dim">Die Grafikkarte wurde vom Browser zurückgesetzt.</p><button type="button" class="primary">Neu laden</button>' : ''
    }</div>`;
    el.querySelector('button')?.addEventListener('click', doReload);
  };
  const doReload = () => {
    o.beforeReload?.();
    reload();
  };

  const onLost = (e: Event) => {
    e.preventDefault(); // lets the browser fire webglcontextrestored
    console.warn('[sle] WebGL context lost');
    overlay(false);
    clearTimeout(timer);
    timer = setTimeout(() => overlay(true), o.restoreTimeoutMs ?? 6000);
  };
  const onRestored = () => {
    console.warn('[sle] WebGL context restored → reloading');
    clearTimeout(timer);
    overlay(false);
    setTimeout(doReload, 300);
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    clearTimeout(timer);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}
