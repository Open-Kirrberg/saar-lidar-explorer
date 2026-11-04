/**
 * F9: AOI choice at start-up ('overall' when its manifest exists, else 'karlsberg'; `?aoi=` wins,
 * e.g. `?aoi=karlsberg|fixture` for dev). The "Gebiet" switcher card is gone (ADR 0020).
 */
import { aoiBaseUrl } from '../data/manifest';
import { aoiParam, chooseAoi, chooseDeployedAoi } from '../map/aois';
import { deployedAois } from '../data/urls';

/** Does `<data>/<aoi>/manifest.json` exist and look like a v1/v2 manifest? (Vite answers 404s with index.html.) */
export async function manifestExists(aoi: string): Promise<boolean> {
  try {
    const res = await fetch(aoiBaseUrl(aoi) + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return false;
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return v === 1 || v === 2;
  } catch {
    return false;
  }
}

/** AOI to load at start-up (one small probe for 'overall' unless `?aoi=` is given). */
export async function resolveStartAoi(search: string = location.search): Promise<string> {
  const deployed = deployedAois(); // public build: only the shipped AOIs, no probes
  if (deployed) return chooseDeployedAoi(search, deployed);
  if (aoiParam(search)) return chooseAoi(search, false);
  return chooseAoi(search, await manifestExists('overall'));
}
