import { createReadStream, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { dataSubPath } from './scripts/dataPath.ts';

const PUBLIC_DIR = resolve(import.meta.dirname, 'public');
const PUBLIC_DATA_DIR = join(PUBLIC_DIR, 'data');
/** AOI-independent shared datasets (F19 reconstruction models, contract "Shared datasets"). */
const SHARED_DATA_DIR = join(PUBLIC_DATA_DIR, 'shared');
/** 3D-print exports (pipeline/print3d.py: STL/3MF/PNG, GBs) — local files, never part of dist. */
const PRINT_DATA_DIR = join(PUBLIC_DATA_DIR, 'print');
/** Data dirs under public/data that stay out of dist besides the AOI datasets. */
const NON_DIST_DATA_DIRS = new Set([SHARED_DATA_DIR, PRINT_DATA_DIR]);

/**
 * The single data directory served at `<base>/data/` by `pnpm dev`, `pnpm preview` and
 * `pnpm serve:local`: `public/data` (where the pipeline writes), or `SLE_DATA_DIR`
 * (absolute, or relative to app/) to keep the datasets somewhere else, e.g. an external disk.
 */
const DATA_DIR = process.env.SLE_DATA_DIR ? resolve(import.meta.dirname, process.env.SLE_DATA_DIR) : PUBLIC_DATA_DIR;

/**
 * Public build (`SLE_PUBLIC=1`, GitHub Pages, scripts/release/RELEASING.md): absolute base path and
 * all data from the static data repositories. Every value can be overridden by the same env var;
 * the local build and dev server are unchanged when SLE_PUBLIC is unset.
 */
const PUBLIC_BUILD = process.env.SLE_PUBLIC === '1';
const PUBLIC_BASE = withSlash(process.env.SLE_BASE ?? '/saar-lidar-explorer/');
const PUBLIC_ENV_DEFAULTS: Record<string, string> = {
  VITE_DATA_URL: 'https://open-kirrberg.github.io/saar-lidar-data/',
  VITE_PRINT_URL: 'https://open-kirrberg.github.io/saar-lidar-data-2/print/',
  VITE_AOIS: 'overall',
  VITE_VIEWER_URL: `${PUBLIC_BASE}castle/`,
};
if (PUBLIC_BUILD) {
  // Vite reads VITE_* from process.env after loading this file; explicit env vars win.
  for (const [k, v] of Object.entries(PUBLIC_ENV_DEFAULTS)) process.env[k] ||= v;
  // F22: forced (not a default) — the public app drops the private UXO candidate classes.
  process.env.VITE_SLE_PUBLIC = '1';
  console.log(`[sle] public build: base ${PUBLIC_BASE}, data ${process.env.VITE_DATA_URL}, AOIs ${process.env.VITE_AOIS}`);
}

function withSlash(p: string): string {
  return p.endsWith('/') ? p : `${p}/`;
}

/** AOI datasets = sub-directories of public/data that contain a manifest.json (hundreds of MB). */
function isAoiDir(path: string): boolean {
  return statSync(path).isDirectory() && existsSync(join(path, 'manifest.json'));
}

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
};

type Next = (err?: unknown) => void;

/**
 * Connect middleware: `<base>data/<path>` → `DATA_DIR/<path>` (GET/HEAD, Last-Modified + 304).
 * A path that is in neither `DATA_DIR` nor `fallbackDir/data` gets a real 404 — without it the
 * SPA fallback would answer a missing `manifest.json` with index.html (200).
 */
function dataMiddleware(fallbackDir: () => string, base: () => string) {
  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // Anchored at `<base>data/` — `/src/data/manifest.ts` etc. must reach Vite (dataPath.ts).
    const sub = dataSubPath(req.url ?? '', base());
    if (sub === null) return next();
    const file = normalize(join(DATA_DIR, sub));
    if (!file.startsWith(DATA_DIR + sep)) return next();
    const st = existsSync(file) ? statSync(file) : undefined;
    if (!st?.isFile()) {
      const other = normalize(join(fallbackDir(), 'data', sub));
      if (existsSync(other)) return next();
      res.statusCode = 404;
      return res.end();
    }
    const mtime = new Date(Math.floor(st.mtimeMs / 1000) * 1000);
    res.setHeader('Last-Modified', mtime.toUTCString());
    res.setHeader('Cache-Control', 'no-cache'); // revalidate: the pipeline may rewrite files
    const since = Date.parse(String(req.headers['if-modified-since'] ?? ''));
    if (Number.isFinite(since) && mtime.getTime() <= since) {
      res.statusCode = 304;
      return res.end();
    }
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(st.size));
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', next).pipe(res);
  };
}

/**
 * `public/data/<aoi>/` is NOT copied into `dist/` (190 MB – 1.4 GB per AOI). The build copies the
 * rest of `public/` (e.g. data/pois.geojson); `vite preview` serves the AOI datasets straight from
 * the data dir (above). With `SLE_DATA_DIR` set, the dev server serves from there as well.
 * For a separate static host, build with `VITE_DATA_URL=https://…/data/` (see README).
 */
function publicWithoutAoiData(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sle-public-without-aoi-data',
    // Build + preview only (vitest / dev server must not run closeBundle).
    apply: (_config, env) => env.command === 'build' || !!env.isPreview,
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      if (!existsSync(PUBLIC_DIR)) return;
      cpSync(PUBLIC_DIR, outDir, {
        recursive: true,
        // AOI datasets, the shared datasets (F19, data/shared/) and the 3D-print exports
        // (data/print/) stay in the data dir.
        // The public build ships no data at all (it lives in the data repositories).
        filter: (src) =>
          !(PUBLIC_BUILD && normalize(src) === PUBLIC_DATA_DIR) &&
          !(normalize(src).startsWith(PUBLIC_DATA_DIR + sep) && (NON_DIST_DATA_DIRS.has(normalize(src)) || isAoiDir(src))),
      });
      const skipped = existsSync(PUBLIC_DATA_DIR)
        ? readdirSync(PUBLIC_DATA_DIR).filter((d) => isAoiDir(join(PUBLIC_DATA_DIR, d)))
        : [];
      if (skipped.length) console.log(`[sle] not copied to dist (served from the data dir or VITE_DATA_URL): ${skipped.join(', ')}`);
    },
    configurePreviewServer(server) {
      console.log(`[sle] serving AOI data from ${DATA_DIR}`);
      server.middlewares.use(dataMiddleware(() => outDir, () => server.config.base));
    },
  };
}

/** Dev server: only needed when the data lives outside public/ (`SLE_DATA_DIR`). */
function devDataDir(): Plugin {
  return {
    name: 'sle-dev-data-dir',
    apply: 'serve',
    configureServer(server) {
      if (DATA_DIR === PUBLIC_DATA_DIR) return;
      console.log(`[sle] serving AOI data from ${DATA_DIR}`);
      server.middlewares.use(dataMiddleware(() => PUBLIC_DIR, () => server.config.base));
    },
  };
}

/**
 * F20: opt-in HTTPS on the LAN (`pnpm run dev:lan` sets SLE_HTTPS=1, host 0.0.0.0, port 5243) so
 * phones get a secure context (geolocation, compass). Self-signed certificate; plain `pnpm dev`,
 * `vite preview` and `vite build` are unaffected.
 */
const LAN_HTTPS = process.env.SLE_HTTPS === '1';

function lanHttpsNotice(): Plugin {
  return {
    name: 'sle-lan-https-notice',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address();
        const port = addr && typeof addr === 'object' ? addr.port : 5243;
        const host = server.config.server.host;
        const lan = host === true || host === '0.0.0.0' || host === '::';
        const ips = Object.values(networkInterfaces())
          .flat()
          .filter((i) => i && i.family === 'IPv4' && !i.internal)
          .map((i) => i!.address);
        const urls = !lan
          ? `(nur lokal, Host ${String(host)})`
          : ips.length
            ? ips.map((ip) => `https://${ip}:${port}/`).join('  ')
            : `https://<LAN-IP>:${port}/`;
        console.log(
          `\n[sle] LAN-HTTPS aktiv – am Handy öffnen: ${urls}\n` +
            '[sle] Selbstsigniertes Zertifikat: die Warnung im Handy-Browser einmal bestätigen.\n' +
            '[sle] Achtung: Jeder im selben Netz erreicht die App (inkl. Verdachtsflächen/Daten) – nur kurz laufen lassen, Strg+C beendet.\n',
        );
      });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path; the public build uses its absolute path.
  base: PUBLIC_BUILD ? PUBLIC_BASE : './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, copyPublicDir: false },
  plugins: [publicWithoutAoiData(), devDataDir(), ...(LAN_HTTPS ? [basicSsl({ name: 'sle-lan' }), lanHttpsNotice()] : [])],
  // Own dep-optimizer cache, so a LAN server next to a normal `pnpm dev` doesn't re-optimize the other's deps.
  ...(LAN_HTTPS ? { cacheDir: 'node_modules/.vite-lan' } : {}),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
