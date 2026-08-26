import { z } from "zod"
import { readFileSync } from "node:fs"
import { isBusiness, isCloud } from "./config.js"

/**
 * Deployment surface profile (B1). Rides the runtime-config channel: env
 * NODARO_SURFACE_PROFILE (inline JSON or "@/path/to/file.json") → Zod-validated
 * here → applied backend-side and mirrored to the browser via /config.js.
 *
 * CONTRACT: every array default is [] meaning "inherit the code default". Deny
 * / hide / whitelist are NARROWING operations layered over what the code
 * already renders, so the stock default is inert (mainline byte-identical when
 * the env is unset) and there is no "empty = everything hidden" footgun. A
 * non-empty array is an explicit narrowing.
 *
 * Kept in core (NOT packages/shared) and duplicated in
 * frontend/src/lib/surface-profile.ts with a drift test — same rationale as
 * cloud-only-nodes.ts: this is edition/deployment config, not a public wire
 * contract, and packages/shared is an irrevocable Apache grant.
 */

export type NavKey = "gallery" | "explore" | "pricing" | "templates" | "apps" | "community"
export const DASHBOARD_TAB_KEYS = [
  "workflows",
  "projects",
  "apps",
  "miniapps",
  "templates",
  "tutorials",
  "statistics",
  "gallery",
] as const
export type DashboardTabKey = (typeof DASHBOARD_TAB_KEYS)[number]
export type AuthMethod = "email" | "google" | "sso"

export interface SurfaceSibling {
  label: string
  url: string
}

export interface SurfaceProfile {
  nav: { hide: NavKey[] }
  dashboard: { tabs: DashboardTabKey[] }
  nodes: { deny: string[] }
  models: { deny: string[] }
  auth: { methods: AuthMethod[]; ssoLabel?: string }
  siblings: { apps: SurfaceSibling[] }
  brand: { productName: string; description?: string }
  locale: { default?: string; picker: boolean }
  outputs: { allowPublic: boolean }
  voice: { allowedGenders: string[] } // B4c — [] = all genders allowed (narrowing only)
  catalogPolicy?: unknown // B4 (Phase 4) — carried opaque; validated loosely, never read here
}

export const SURFACE_PROFILE_DEFAULT: SurfaceProfile = {
  nav: { hide: [] },
  dashboard: { tabs: [] },
  nodes: { deny: [] },
  models: { deny: [] },
  auth: { methods: [] },
  siblings: { apps: [] },
  brand: { productName: "Nodaro" },
  locale: { picker: true },
  outputs: { allowPublic: true },
  voice: { allowedGenders: [] },
}

const NAV_KEYS = z.enum(["gallery", "explore", "pricing", "templates", "apps", "community"])
const TAB_KEYS = z.enum([...DASHBOARD_TAB_KEYS])
const AUTH_METHODS = z.enum(["email", "google", "sso"])

/**
 * Coerce to an array and keep ONLY known enum members — one bad entry is
 * dropped element-wise (not the whole field), so `["gallery","bogus"]` →
 * `["gallery"]`. A partial config is a first-class state (A3's degrade
 * philosophy). Non-array input degrades to []. Takes the enum's `.options`
 * value tuple directly, so the helper is decoupled from Zod's ZodEnum generic
 * (Zod 4 changed it from a value tuple to an enum-like record).
 */
const knownEnumArray = <T extends string>(values: readonly T[]) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((a) => a.filter((x): x is T => (values as readonly string[]).includes(x as string)))

/**
 * Coerce to an array of strings element-wise: keep every string, drop any
 * non-string member — one bad entry does NOT reject the whole array. Mirrors
 * knownEnumArray's degrade philosophy for the free-form deny lists (nodes /
 * models), where the members aren't a closed enum. `z.array(z.string())` failed
 * the WHOLE field on one non-string, and `.catch([])` then dropped EVERY deny
 * entry — silently un-denying everything (a privacy/gating fail-open).
 */
const stringArray = () =>
  z
    .array(z.unknown())
    .catch([])
    .transform((a) => a.filter((x): x is string => typeof x === "string"))

/**
 * Lenient boolean for a PRIVACY control (outputs.allowPublic). Accept a real
 * boolean, or the strings "true"/"false"/"1"/"0" (a profile can reach us
 * stringified through the JSON/env channel). Default to `true` — and warn —
 * ONLY when the value is genuinely absent or unparseable. A present `false`
 * (boolean or string) is NEVER silently flipped to `true`: a fail-OPEN privacy
 * control is worse than a loud misconfig warning. The old `z.boolean().catch(true)`
 * had exactly that bug — a stringified `"false"` failed z.boolean(), so the whole
 * `outputs` object caught to `{ allowPublic: true }` and privacy flipped open.
 */
const lenientPublicFlag = z.unknown().transform((v) => {
  if (typeof v === "boolean") return v
  if (v === "true" || v === "1") return true
  if (v === "false" || v === "0") return false
  console.warn("[surface-profile] outputs.allowPublic absent or unparseable — defaulting to public (true)")
  return true
})

/**
 * Structural schema. Each top-level field `.catch`es to its default, so an
 * absent OR malformed field degrades to the default rather than failing the
 * whole profile. The edition refinement is layered on in Task 2
 * (parseSurfaceProfile stays the single funnel).
 */
export const SurfaceProfileSchema: z.ZodType<SurfaceProfile> = z.object({
  nav: z.object({ hide: knownEnumArray(NAV_KEYS.options) }).catch({ hide: [] }),
  dashboard: z.object({ tabs: knownEnumArray(TAB_KEYS.options) }).catch({ tabs: [] }),
  nodes: z.object({ deny: stringArray() }).catch({ deny: [] }),
  models: z.object({ deny: stringArray() }).catch({ deny: [] }),
  auth: z
    .object({ methods: knownEnumArray(AUTH_METHODS.options), ssoLabel: z.string().optional() })
    .catch({ methods: [] }),
  siblings: z
    .object({ apps: z.array(z.object({ label: z.string(), url: z.string() })).catch([]) })
    .catch({ apps: [] }),
  brand: z.object({ productName: z.string().min(1), description: z.string().optional() }).catch({ productName: "Nodaro" }),
  locale: z.object({ default: z.string().optional(), picker: z.boolean() }).catch({ picker: true }),
  outputs: z.object({ allowPublic: lenientPublicFlag }).catch({ allowPublic: true }),
  voice: z.object({ allowedGenders: stringArray() }).catch({ allowedGenders: [] }),
  catalogPolicy: z.unknown().optional(),
}) as z.ZodType<SurfaceProfile>

/** One-level-deep merge: each override sub-object replaces the default's, keys
 *  absent from the override keep the default. Arrays replace wholesale. */
function mergeOverDefault(override: Partial<SurfaceProfile>): SurfaceProfile {
  const d = SURFACE_PROFILE_DEFAULT
  return {
    nav: { ...d.nav, ...override.nav },
    dashboard: { ...d.dashboard, ...override.dashboard },
    nodes: { ...d.nodes, ...override.nodes },
    models: { ...d.models, ...override.models },
    auth: { ...d.auth, ...override.auth },
    siblings: { ...d.siblings, ...override.siblings },
    brand: { ...d.brand, ...override.brand },
    locale: { ...d.locale, ...override.locale },
    outputs: { ...d.outputs, ...override.outputs },
    voice: { ...d.voice, ...override.voice },
    catalogPolicy: override.catalogPolicy ?? d.catalogPolicy,
  }
}

/**
 * Resolve the raw env value (inline JSON, or "@path" to a JSON file) into a
 * validated profile. Never throws: any parse/validation failure logs and
 * returns the stock default.
 */
export function parseSurfaceProfile(raw: string | undefined): SurfaceProfile {
  const trimmed = raw?.trim()
  if (!trimmed) return SURFACE_PROFILE_DEFAULT
  let text = trimmed
  if (trimmed.startsWith("@")) {
    try {
      text = readFileSync(trimmed.slice(1), "utf8")
    } catch (err) {
      console.warn(`[surface-profile] could not read ${trimmed} — using stock default:`, (err as Error).message)
      return SURFACE_PROFILE_DEFAULT
    }
  }
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (err) {
    console.warn("[surface-profile] NODARO_SURFACE_PROFILE is not valid JSON — using stock default:", (err as Error).message)
    return SURFACE_PROFILE_DEFAULT
  }
  const parsed = SurfaceProfileSchema.safeParse(obj)
  if (!parsed.success) {
    console.warn("[surface-profile] NODARO_SURFACE_PROFILE failed validation — using stock default:", parsed.error.message)
    return SURFACE_PROFILE_DEFAULT
  }
  return mergeOverDefault(parsed.data as Partial<SurfaceProfile>)
}

/**
 * d2 gate (RESOLVED — spec §9 d2, Branch B): the deployment surface profile is a
 * business-tier / white-label capability. Community ignores NODARO_SURFACE_PROFILE
 * entirely and always serves the stock default. Uses the edition helpers, never a
 * raw config.EDITION check.
 */
export function surfaceGateOpen(): boolean {
  return isBusiness() || isCloud()
}

/**
 * True when the deployment restricts sign-in to SSO ONLY — auth.methods is
 * non-empty and every entry is "sso". Drives the server-authoritative SSO gate
 * (middleware/auth.ts, SAI-5 / H6): on such a deployment, every JWT-authenticated
 * account must have been provisioned through the SSO path. Inert by default
 * (auth.methods defaults [] → false → gate off, mainline unaffected); also false
 * when a deployment allows mixed auth (e.g. ["email","sso"]), since a
 * password/OAuth account is legitimate there.
 */
export function surfaceSsoOnly(): boolean {
  const methods = runtimeSurfaceProfile().auth.methods
  return methods.length > 0 && methods.every((m) => m === "sso")
}

/**
 * Fail-closed guard (SAI-4 / H8). True when a deployment CONFIGURED a surface
 * profile (NODARO_SURFACE_PROFILE set) on an edition that honors it
 * (surfaceGateOpen) but the profile did NOT load — detected because
 * parseSurfaceProfile returns the SURFACE_PROFILE_DEFAULT object BY IDENTITY on
 * every failure path (unreadable @file, invalid JSON, failed validation), while
 * a successful parse always returns a fresh object (mergeOverDefault), even when
 * its values happen to match the defaults. So `runtimeSurfaceProfile() ===
 * SURFACE_PROFILE_DEFAULT` with the env set and the gate open is an un-fakeable
 * "the profile I asked for did not load" signal.
 *
 * app.ts turns a true here into exit(1): booting a NARROWING deployment
 * mainline-open (email login, Nodaro brand, un-denied nodes/models, unrestricted
 * voice genders, the public gallery) is a security failure — a partial config
 * must fail closed, not serve everything with a lone console.warn.
 */
export function surfaceProfileFailedToLoad(): boolean {
  return (
    Boolean(process.env.NODARO_SURFACE_PROFILE?.trim()) &&
    surfaceGateOpen() &&
    runtimeSurfaceProfile() === SURFACE_PROFILE_DEFAULT
  )
}

/**
 * Narrows-never-widens refinement: strip anything the profile tries to turn ON
 * that the edition (or the profile itself) does not actually support. Only
 * additive vectors need checking — subtractive fields (nav.hide, *.deny,
 * dashboard.tabs whitelist) can only remove and are left as-is. Today the one
 * widen vector is auth: "sso" without a configured ssoLabel is not serveable.
 */
export function refineSurfaceEdition(p: SurfaceProfile): SurfaceProfile {
  const methods = p.auth.methods.filter((m) => (m === "sso" ? Boolean(p.auth.ssoLabel) : true))
  return methods.length === p.auth.methods.length ? p : { ...p, auth: { ...p.auth, methods } }
}

let cached: SurfaceProfile | undefined

/** Test hook: clear the memoized profile between cases (used by Tasks 8–10). */
export function __resetSurfaceProfileCacheForTests(): void {
  cached = undefined
}

/**
 * The single backend read of the resolved, refined profile (memoized).
 *
 * Reads NODARO_SURFACE_PROFILE fresh from process.env rather than from the
 * `config` snapshot: `config` parses process.env once at import, so a memoized
 * getter that read `config.NODARO_SURFACE_PROFILE` could never be re-driven by a
 * test that sets the env then resets the cache. Production behaviour is identical
 * (env is fixed at boot); tests gain a real seam.
 */
export function runtimeSurfaceProfile(): SurfaceProfile {
  if (cached) return cached
  cached = surfaceGateOpen()
    ? refineSurfaceEdition(parseSurfaceProfile(process.env.NODARO_SURFACE_PROFILE))
    : SURFACE_PROFILE_DEFAULT
  return cached
}
