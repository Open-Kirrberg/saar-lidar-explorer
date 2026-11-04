/**
 * Standalone viewer of Schloss Karlsberg 1789 (V2.7): mounts the zone runtime (castle.ts) in `#app` on a renderer of
 * its own and drives it with requestAnimationFrame. URL: `?tier=standard|entdecker|labor` (default labor),
 * `?quality=auto|hoch|mittel|niedrig|mobil` (default hoch), `?intro=rundflug`, plus the explorer handover
 * (`?src=explorer&E=…`, docs/explorer-integration.md). Test hooks: `window.skb` (castle.ts).
 */
import { createCastle } from './castle.ts';
import { parseHandover } from './handover.ts';
import { isZoneQuality } from './quality.ts';
import type { ZoneTier } from './zone/api.ts';

const TIERS: readonly ZoneTier[] = ['standard', 'entdecker', 'labor'];

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const q = new URLSearchParams(location.search);
  const t = q.get('tier');
  const tier: ZoneTier = TIERS.includes(t as ZoneTier) ? (t as ZoneTier) : 'labor';
  const qp = q.get('quality');
  const quality = isZoneQuality(qp) ? qp : 'hoch';
  const intro = q.get('intro') === 'rundflug' ? 'rundflug' : 'none';

  const status = document.createElement('div');
  status.className = 'boot-status';
  status.textContent = 'Lade …';
  document.body.appendChild(status);
  const castle = await createCastle({ container: app, baseUrl: './', tier, quality, onProgress: (label) => (status.textContent = label) }, { handover: parseHandover(location.search) });
  status.remove();

  const fit = () => castle.resize(app.clientWidth, app.clientHeight);
  addEventListener('resize', fit);
  fit();
  castle.start({ intro });
  (window as unknown as { skb: unknown }).skb = castle.hooks;

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    castle.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error('[viewer]', e);
  const s = document.querySelector('.boot-status') ?? document.body.appendChild(document.createElement('div'));
  s.className = 'boot-status';
  s.textContent = `Fehler beim Laden: ${e instanceof Error ? e.message : String(e)}`;
});
