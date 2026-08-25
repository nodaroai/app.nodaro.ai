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
 * Every read of `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
 * and `VITE_FREECUT_URL` goes through here; a raw `import.meta.env` read
 * of those three elsewhere is a regression (guard test in
 * `__tests__/runtime-config.test.ts`).
 */
export interface NodaroRuntimeConfig {
  readonly apiUrl?: string
  readonly supabaseUrl?: string
  readonly supabaseAnonKey?: string
  readonly freecutUrl?: string
  readonly defaultLocale?: string
  /**
   * Deployment surface profile (B1) — a partial narrowing set by the /config.js
   * writer (tools/build-runtime-config.mjs), read through surface-profile.ts's
   * runtimeSurfaceProfile()/selectors. Partial: the writer passes arbitrary
   * validated JSON, and consumers merge it over the code default.
   */
  readonly surface?: Partial<import("./surface-profile").SurfaceProfile>
  /**
   * Upload-moderation capability (G3). Set by the /config.js writer from env
   * RUNTIME_UPLOAD_MODERATION when a deployment wires a moderation plugin
   * route (POST /v1/moderate-image, provided via @nodaroai/cloud-plugins
   * registerRoutes — never in core). Absent on mainline: the upload-image
   * node then never calls moderation and never renders the overlay.
   */
  readonly moderation?: { readonly uploadImage?: boolean }
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

/**
 * The video editor this install embeds.
 *
 * Runtime-overridable for the same reason as the trio above: the published
 * community image is built once, and an operator running their own FreeCut
 * (github.com/nodaroai/freecut — public, MIT) must be able to point at it with
 * a `.env` value and a restart rather than rebuilding the image (#767).
 *
 * The default is the hosted editor, which already allowlists `http://localhost:*`
 * in its `frame-ancestors`, so a quickstart-shaped install gets a working editor
 * with nothing to configure. Other origins are NOT allowlisted by decision —
 * they ask to be added, or self-host and override this.
 *
 * Set the value to `off` to remove the feature entirely — the honest state for
 * an air-gapped install, or an operator who does not want the hosted editor.
 * An empty/unset value is NOT that: it means "no preference", which takes the
 * default. Without an explicit off switch there is no way to turn the button
 * off, and a button that opens a frame that cannot load is worse than absent.
 */
export const DEFAULT_FREECUT_URL = "https://freecut.nodaro.ai"

/** Explicit opt-out. Any casing; surrounding whitespace ignored. */
const FREECUT_DISABLED_VALUES = new Set(["off", "none", "false", "disabled"])

/**
 * An absolute http(s) URL, or empty when the editor is switched off.
 *
 * A malformed value falls back to the default rather than resolving against the
 * page: `new URL(junk, location.href)` succeeds by treating junk as a relative
 * path, which would make the editor "our own origin" — and would then have the
 * postMessage check trust messages from ourselves.
 */
export function runtimeFreecutUrl(): string {
  const configured = pick(runtime().freecutUrl, import.meta.env.VITE_FREECUT_URL as string | undefined).trim()
  if (FREECUT_DISABLED_VALUES.has(configured.toLowerCase())) return ""
  if (!configured) return DEFAULT_FREECUT_URL
  return isAbsoluteHttpUrl(configured) ? configured : DEFAULT_FREECUT_URL
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/**
 * The origin every inbound editor postMessage is checked against. Derived from
 * the SAME value the frame is loaded from — a URL and an origin that disagree
 * means every message is silently dropped. Empty when the URL is unusable.
 */
export function runtimeFreecutOrigin(): string {
  const url = runtimeFreecutUrl()
  if (!url) return ""
  try {
    // No base on purpose — runtimeFreecutUrl only ever returns an absolute
    // http(s) URL or empty, so a base could only mask a bad value.
    return new URL(url).origin
  } catch {
    return ""
  }
}

/**
 * The locale a fresh visitor to THIS deployment starts in — env `DEFAULT_LOCALE`
 * → `/config.js`. Runtime-only: unlike the trio there is no build-time default,
 * so an unset or blank value returns "" and the caller keeps its own fallback.
 * Whether the string names a locale we ship is the locale layer's decision, not
 * ours; it ranks this BELOW a saved choice and ABOVE browser detection.
 */
export function runtimeDefaultLocale(): string {
  return (runtime().defaultLocale ?? "").trim()
}

/**
 * Whether this deployment has an upload-image moderation provider wired
 * (G3). The upload-image node checks this BEFORE calling moderation AND
 * before rendering the moderation overlay, so an install with no moderation
 * plugin behaves identically to pre-feature mainline — even if a node in an
 * imported workflow carries a persisted moderationStatus.
 */
export function runtimeUploadModerationEnabled(): boolean {
  return runtime().moderation?.uploadImage === true
}
