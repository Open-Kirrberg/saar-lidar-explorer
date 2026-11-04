/**
 * Build-time URL configuration (no DOM, no three). Every value comes from a `VITE_*` env var and
 * defaults to the local behaviour (data under `<BASE_URL>data/`, castle viewer on localhost, all
 * known AOIs probed). The public GitHub Pages build (`SLE_PUBLIC=1`, see vite.config.ts and
 * scripts/release/RELEASING.md) sets them so the site loads everything from absolute data URLs.
 *
 *   VITE_DATA_URL    root of the AOI datasets, pois.geojson and data/shared/   (manifest.ts dataRootUrl)
 *   VITE_AOIS        comma list of the AOIs the deployment has (e.g. `overall`); default: all known
 *   VITE_VIEWER_URL  castle viewer URL (relative ones resolve against the page); `off` hides the handover
 *   VITE_IMPRESSUM_URL  optional Impressum page (http(s); relative ones resolve against the page),
 *                    linked in „Über & Datenschutz“; unset → no Impressum link (no default)
 */

type Env = Record<string, string | undefined>;

function env(): Env {
  // Literal `import.meta.env` (Vite replaces exactly this expression at build time).
  return (import.meta.env as Env | undefined) ?? {};
}

function pageHref(): string | undefined {
  return typeof location !== 'undefined' && location?.href ? location.href : undefined;
}

/** `root` with exactly one trailing slash, resolved against the page URL when there is one. */
export function absoluteRoot(root: string, href: string | undefined = pageHref()): string {
  const r = root.endsWith('/') ? root : `${root}/`;
  return href ? new URL(r, href).href : r;
}

/** Is `path` an absolute http(s) URL (manifest paths may point to another static host)? */
export function isAbsoluteHttpUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

/**
 * Resolve a manifest path (possibly a `{z}/{x}/{y}` or `{i}_{j}` template) against the AOI base URL.
 * Absolute http(s) URLs are kept as they are (contract: `xyz.<key>.url` may be absolute, used when
 * the tiles live in a second data repository); everything else is appended to `baseUrl` unchanged
 * (no `new URL()`: it would percent-encode the template braces).
 */
export function resolveDataPath(baseUrl: string, path: string): string {
  return isAbsoluteHttpUrl(path) ? path : baseUrl + path;
}

/** Parse a comma list of AOI ids (`[\w-]+`); empty / unset → null (= all known AOIs). */
export function parseAoiList(raw: string | undefined | null): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[\w-]+$/.test(s));
  return ids.length ? [...new Set(ids)] : null;
}

/** AOIs this deployment ships (`VITE_AOIS`), or null for "probe all known AOIs". */
export function deployedAois(): string[] | null {
  return parseAoiList(env().VITE_AOIS);
}

/**
 * Castle viewer URL override: null = use the dataset's `viewer.url` (local dev), `'off'` = no
 * handover in this build, else the absolute URL (relative values resolve against the page).
 */
export function viewerUrlOverride(raw: string | undefined = env().VITE_VIEWER_URL, href: string | undefined = pageHref()): string | 'off' | null {
  if (!raw) return null;
  if (raw.trim().toLowerCase() === 'off') return 'off';
  try {
    return href ? new URL(raw, href).href : new URL(raw).href;
  } catch {
    return null;
  }
}

/**
 * Impressum link for „Über & Datenschutz“ (`VITE_IMPRESSUM_URL`): an http(s) URL (relative values
 * resolve against the page), else null (unset, other schemes such as `javascript:`, credentials).
 */
export function impressumUrl(raw: string | undefined = env().VITE_IMPRESSUM_URL, href: string | undefined = pageHref()): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = href ? new URL(v, href) : new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
