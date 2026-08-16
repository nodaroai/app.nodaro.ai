/**
 * Runtime overrides for the three values Vite inlines at build time.
 *
 * The published community image is built once and must serve any
 * `PUBLIC_URL` — a different port, a domain behind a proxy — without a
 * rebuild. `start.sh` writes `/config.js` from the container's env at boot
 * (served by Caddy with `no-store`), `index.html` loads it as a classic
 * script BEFORE the app's module entry, and these getters prefer what it set
 * over the inlined `import.meta.env.VITE_*` value. A missing or empty
 * override falls back to the build-time value, so the cloud (where the two
 * agree) is byte-for-byte unchanged (#700, release check 13).
 *
 * Every read of `VITE_API_URL`, `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY` goes through here; a raw `import.meta.env` read
 * of those three elsewhere is a regression (guard test in
 * `__tests__/runtime-config.test.ts`).
 */
export interface NodaroRuntimeConfig {
  readonly apiUrl?: string
  readonly supabaseUrl?: string
  readonly supabaseAnonKey?: string
}

declare global {
  interface Window {
    __NODARO_RUNTIME__?: NodaroRuntimeConfig
  }
}

function runtime(): NodaroRuntimeConfig {
  return (typeof window !== "undefined" && window.__NODARO_RUNTIME__) || {}
}

const pick = (override: string | undefined, baked: string | undefined): string =>
  (override && override.trim()) || (baked ?? "")

/** Where the browser reaches the API directly (SSE — everything else is same-origin). */
export function runtimeApiUrl(): string {
  return pick(runtime().apiUrl, import.meta.env.VITE_API_URL as string | undefined)
}

/** The Supabase URL the BROWSER uses (auth + PostgREST). */
export function runtimeSupabaseUrl(): string {
  return pick(runtime().supabaseUrl, import.meta.env.VITE_SUPABASE_URL as string | undefined)
}

export function runtimeSupabaseAnonKey(): string {
  return pick(runtime().supabaseAnonKey, import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
}
