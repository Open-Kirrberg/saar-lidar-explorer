/**
 * Copy text with a bounded wait (v1.0.1 audit): `navigator.clipboard.writeText` can stay pending
 * forever without user activation (e.g. automated/hidden tabs), so it races a timeout and then
 * falls back to `execCommand('copy')`. Pure with injected primitives (tested); `copyText` wires
 * the browser ones.
 */

export interface CopyDeps {
  /** Async Clipboard API, if available. */
  writeText?: (text: string) => Promise<void>;
  /** Synchronous legacy copy; returns success. */
  execCopy: (text: string) => boolean;
  timeoutMs?: number;
}

export const CLIPBOARD_TIMEOUT_MS = 1500;

/** Resolves to the promise's value, or `onTimeout` if it hasn't settled after `ms`. Rejections propagate. */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => (timer = setTimeout(() => resolve(onTimeout), ms)));
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export async function copyWith(text: string, deps: CopyDeps): Promise<boolean> {
  if (deps.writeText) {
    try {
      const ok = await withTimeout(
        deps.writeText(text).then(() => true),
        deps.timeoutMs ?? CLIPBOARD_TIMEOUT_MS,
        false,
      );
      if (ok) return true;
    } catch {
      /* insecure context, permissions → fall back */
    }
  }
  try {
    return deps.execCopy(text);
  } catch {
    return false;
  }
}

function execCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } finally {
    ta.remove();
  }
}

/** Browser copy: Clipboard API (≤ 1.5 s) → execCommand. */
export function copyText(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  return copyWith(text, { writeText: clip?.writeText ? (t) => clip.writeText(t) : undefined, execCopy });
}
