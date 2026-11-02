/**
 * F22: is this a public build? `SLE_PUBLIC=1` (vite.config.ts) forces `VITE_SLE_PUBLIC=1`; the
 * public site must never show the private UXO candidate classes (`crater`, `crater_field`), even
 * if a data repository contained them. Pure apart from reading `import.meta.env`; unit-tested.
 */
type Env = Record<string, string | boolean | undefined>;

function viteEnv(): Env {
  // Literal `import.meta.env` (Vite replaces exactly this expression at build time).
  return (import.meta.env as Env | undefined) ?? {};
}

export function isPublicBuild(env: Env = viteEnv()): boolean {
  return env.VITE_SLE_PUBLIC === '1';
}

/** UXO candidate classes are loaded only outside public builds. */
export function uxoClassesAllowed(env: Env = viteEnv()): boolean {
  return !isPublicBuild(env);
}
