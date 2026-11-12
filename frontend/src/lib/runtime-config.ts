import {
  isHttpsOrigin,
  resolveRuntimeApiBase,
  resolveRuntimeSupabaseUrl,
  type NodaroRuntimeConfig as RuntimeConfigContract,
} from "@nodaro/shared/runtime-config"

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
 * Every read of `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
 * `VITE_FREECUT_URL` and `VITE_AUDIOMASS_URL` goes through here; a raw
 * `import.meta.env` read of those elsewhere is a regression (guard test in
 * `__tests__/runtime-config.test.ts`).
 *
 * The keys, and the same-origin sentinels `apiUrl: "/"` and
 * `supabaseUrl: "/supabase"`, are the published contract in
 * @nodaro/shared/runtime-config: the other products served from the same site
 * read this file too. Each key's meaning is documented at its getter below.
 */
export interface NodaroRuntimeConfig extends Omit<RuntimeConfigContract, "surface"> {
  /**
   * Deployment surface profile (B1) — a partial narrowing set by the /config.js
   * writer (tools/build-runtime-config.mjs), read through surface-profile.ts's
   * runtimeSurfaceProfile()/selectors. Partial: the writer passes arbitrary
   * validated JSON, and consumers merge it over the code default.
   */
  readonly surface?: Partial<import("./surface-profile").SurfaceProfile>
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

/**
 * Where the browser reaches the API directly (SSE — everything else is
 * same-origin).
 *
 * `"/"` is the same-origin SENTINEL: a hosted studio answering on more than one
 * hostname cannot name an API host here, because PUBLIC_URL is single-valued and
 * whichever host it named would be the one every SSE call went to — from every
 * other host, cross-origin. `PUBLIC_URL_SAME_ORIGIN=true` makes the /config.js
 * writer (start.sh → tools/build-runtime-config.mjs) emit `"/"`, and it resolves
 * here to "", which the four SSE consumers already treat as "build the URL
 * relative to this page". It cannot be written as "" in /config.js: an empty
 * override means "no override" and would fall back to the baked VITE_API_URL.
 * The sentinel's rule is the shared contract's, so every product reading this
 * file resolves it the same way and none falls back to an absolute URL.
 */
export function runtimeApiUrl(currentOrigin: string = pageOrigin()): string {
  // On the app's own host (the deployment moved its pages to one) the API is
  // this same service under this same origin: every browser call stays here.
  if (runtimeIsOnFlowUiHost(currentOrigin)) return ""
  return resolveRuntimeApiBase({ apiUrl: pick(runtime().apiUrl, import.meta.env.VITE_API_URL as string | undefined) }) ?? ""
}

function pageOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : ""
}

/**
 * A deployment that moved its pages to a host of their own, as /config.js
 * describes it, or null. On exactly when the proxy's half is on
 * (tools/gen-route-homes.mjs): a Flow origin, at least one legacy host that is
 * not the Flow host, and a kept origin (PUBLIC_URL) that is not the Flow
 * origin. All three or nothing, so the browser never acts where the proxy does
 * not, and no link it writes can name the Flow host.
 */
function movedPages(): { readonly flow: string; readonly hosts: readonly string[]; readonly link: string } | null {
  const { flowUiOrigin: flow, legacyUiHosts, linkOrigin: link } = runtime()
  if (!isHttpsOrigin(flow) || !isHttpsOrigin(link) || link === flow || !Array.isArray(legacyUiHosts)) return null
  const hosts = legacyUiHosts.filter((host): host is string => typeof host === "string" && host !== "")
  return hosts.some((host) => `https://${host}` !== flow) ? { flow, hosts, link } : null
}

/**
 * The https origin the app's own pages live on, when this deployment moved them
 * to a host of their own (FLOW_UI_ORIGIN), else "".
 */
export function runtimeFlowUiOrigin(): string {
  return movedPages()?.flow ?? ""
}

/** The hosts the app's pages moved away from, on a deployment that moved them (LEGACY_UI_HOSTS); else none. */
export function runtimeLegacyUiHosts(): readonly string[] {
  return movedPages()?.hosts ?? []
}

/** Whether this page is on the app's own host (only ever true on a deployment that has one). */
export function runtimeIsOnFlowUiHost(currentOrigin: string = pageOrigin()): boolean {
  const flow = runtimeFlowUiOrigin()
  return flow !== "" && currentOrigin === flow
}

/**
 * Whether this page is on a host the move names: the Flow host or one of the
 * legacy hosts. Any other host the service answers on is left as it was.
 */
export function runtimeIsOnMovedHost(currentOrigin: string = pageOrigin()): boolean {
  const moved = movedPages()
  if (moved === null) return false
  if (currentOrigin === moved.flow) return true
  try {
    return moved.hosts.includes(new URL(currentOrigin).hostname)
  } catch {
    return false
  }
}

/**
 * The https origin developer-facing links name when the app's pages live on
 * their own host (PUBLIC_URL, the host the API keeps), else "": the page's own
 * origin, as ever, for the one-host deployment. See lib/public-links.ts.
 */
export function runtimeLinkOrigin(): string {
  return movedPages()?.link ?? ""
}

/**
 * Where this page takes a browser's saved settings from (lib/storage-bridge-import.ts):
 * the kept origin (PUBLIC_URL), when the deployment gives its pages a host of
 * their own (FLOW_UI_ORIGIN, with or without the move) and this page is on it;
 * else "". The proxy serves the kept host's bridge page by the same rule (a Flow
 * origin, and a kept origin that is not it: tools/gen-route-homes.mjs). Nothing
 * else follows it: API calls, links and navigation still follow the move alone.
 */
export function runtimeSettingsSourceOrigin(currentOrigin: string = pageOrigin()): string {
  const { flowUiOrigin: flow, linkOrigin: kept } = runtime()
  if (!isHttpsOrigin(flow) || !isHttpsOrigin(kept) || kept === flow) return ""
  return currentOrigin === flow ? kept : ""
}

/** The Supabase URL the BROWSER uses (auth + PostgREST). */
export function runtimeSupabaseUrl(): string {
  const picked = pick(runtime().supabaseUrl, import.meta.env.VITE_SUPABASE_URL as string | undefined)
  // supabase-js requires an absolute URL; resolve the deployment's explicit
  // proxy sentinel on the page so additional studio hostnames stay on-origin.
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return resolveRuntimeSupabaseUrl({ supabaseUrl: picked }, origin) ?? ""
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

/** Explicit opt-out for an embedded editor. Any casing; surrounding whitespace ignored. */
const EDITOR_DISABLED_VALUES = new Set(["off", "none", "false", "disabled"])

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
  if (EDITOR_DISABLED_VALUES.has(configured.toLowerCase())) return ""
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
 * The audio editor this install embeds (AudioMass in an iframe).
 *
 * Runtime-overridable for the same reason as FreeCut above: the published
 * cloud/community image is built once, and a Nodaro-operated tenant or a
 * self-hoster points it at their own AudioMass with an `AUDIOMASS_URL` env and
 * a restart rather than rebuilding the image.
 *
 * Unlike FreeCut there is NO public hosted AudioMass to fall back to, so an
 * unconfigured install has no editor: the default is "" (disabled), and the
 * modal says so instead of framing a dead `http://localhost:5175` dev server —
 * the old build-time fallback, which only ever worked on a developer's laptop.
 * Set `AUDIOMASS_URL` to a reachable editor to enable it; `off` (and the other
 * opt-out words) map to the same disabled state, for symmetry with FREECUT_URL.
 * An empty value is NOT a silent regression here the way it was for FreeCut:
 * there is nothing working to remove — no editor was ever hosted for it.
 */
export const DEFAULT_AUDIOMASS_URL = ""

/** An absolute http(s) URL, or empty when no audio editor is configured. */
export function runtimeAudiomassUrl(): string {
  const configured = pick(runtime().audiomassUrl, import.meta.env.VITE_AUDIOMASS_URL as string | undefined).trim()
  if (EDITOR_DISABLED_VALUES.has(configured.toLowerCase())) return ""
  if (!configured) return DEFAULT_AUDIOMASS_URL
  return isAbsoluteHttpUrl(configured) ? configured : DEFAULT_AUDIOMASS_URL
}

/**
 * The origin every inbound AudioMass postMessage is checked against — derived
 * from the SAME getter as the frame URL so the two can never disagree. Empty
 * when no editor is configured, so nothing is trusted (and a junk value never
 * resolves against our own origin — see runtimeFreecutOrigin).
 */
export function runtimeAudiomassOrigin(): string {
  const url = runtimeAudiomassUrl()
  if (!url) return ""
  try {
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

/**
 * Is the preview stop rule on for this deployment? (`PREVIEW_STOP_RULE_ENABLED`,
 * handed over by /config.js.) Only an explicit `true` turns it on; a dev
 * server's empty /config.js, or production while it is off, reads false.
 */
export function runtimePreviewStopRule(): boolean {
  return runtime().previewStopRule === true
}

/**
 * The https origin this deployment serves user media from, as `/config.js`
 * names it, or undefined: only a white-label deployment's `/config.js` carries
 * one, and a value that is not an https origin is no value (the shared
 * contract's rule).
 */
export function runtimeMediaOrigin(): string | undefined {
  const value = runtime().mediaOrigin
  return isHttpsOrigin(value) ? value : undefined
}
