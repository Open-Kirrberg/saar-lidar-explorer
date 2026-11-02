/**
 * Public website URL + the two QR targets (pure, no DOM, no three).
 *
 *   VITE_PUBLIC_URL   URL of the public site (GitHub Pages); default `DEFAULT_PUBLIC_URL`
 *
 * "Website" = the public URL as it is; "Diese Ansicht" = the public URL + the share hash that
 * "Teilen" copies (pose, look, exaggeration, sun — never markers, candidates or the user's
 * position). When the view would reveal the user's position (F20 locate privacy) there is no
 * view hash at all and the dialog disables that option.
 */
import { formatHash } from '../state';
import type { HashState } from '../state';

export const DEFAULT_PUBLIC_URL = 'https://open-kirrberg.github.io/saar-lidar-explorer/';

type Env = Record<string, string | undefined>;

/** `VITE_PUBLIC_URL` if it is an absolute http(s) URL (hash dropped), else the default. */
export function publicSiteUrl(env: Env = viteEnv()): string {
  const raw = env.VITE_PUBLIC_URL?.trim();
  if (!raw) return DEFAULT_PUBLIC_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_PUBLIC_URL;
    u.hash = '';
    return u.href;
  } catch {
    return DEFAULT_PUBLIC_URL;
  }
}

function viteEnv(): Env {
  return ((import.meta as { env?: Env }).env ?? {}) as Env;
}

/** The public site URL of this build (one constant, see `VITE_PUBLIC_URL`). */
export const PUBLIC_URL = publicSiteUrl();

export type QrTarget = 'site' | 'view';
export const QR_TARGETS: readonly QrTarget[] = ['site', 'view'];
export const QR_TARGET_LABELS: Record<QrTarget, string> = { site: 'Website', view: 'Diese Ansicht' };

/** Share hash of the current view, or null while publishing it would reveal the user's position. */
export function viewHash(state: HashState, revealsPosition: boolean): string | null {
  return revealsPosition ? null : formatHash(state);
}

/**
 * URL encoded in the QR code. `view` without a hash (suppressed) falls back to the plain site URL;
 * the result is ASCII only (non-ASCII is percent-encoded — the QR byte mode here is Latin-1).
 */
export function qrTargetUrl(base: string, target: QrTarget, hash: string | null): string {
  const site = base.replace(/#.*$/, '');
  return asciiUrl(target === 'view' && hash ? `${site}${hash.startsWith('#') ? hash : `#${hash}`}` : site);
}

/** Percent-encode every non-ASCII code point (keeps an already encoded URL unchanged). */
export function asciiUrl(s: string): string {
  return s.replace(/[^\x00-\x7f]/gu, (c) => encodeURIComponent(c));
}
