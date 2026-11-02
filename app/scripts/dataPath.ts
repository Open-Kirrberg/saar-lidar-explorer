/**
 * URL → path inside the data directory for the dev/preview data middleware (`vite.config.ts`).
 *
 * Only `<base>data/<path>` anchored at the start of the URL path counts: a `/data/` segment
 * further down (e.g. the app's own module `/src/data/manifest.ts`) must reach Vite untouched.
 * Returns null when the URL is not a data URL (or is malformed).
 */
export function dataSubPath(url: string, base = '/'): string | null {
  let path: string;
  try {
    path = decodeURIComponent(url.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  // A relative base ('./', '') serves the app at the server root.
  const b = base.startsWith('/') ? (base.endsWith('/') ? base : `${base}/`) : '/';
  if (b !== '/' && path.startsWith(b)) path = path.slice(b.length - 1);
  const m = /^\/data\/(.+)$/.exec(path);
  return m ? m[1] : null;
}
