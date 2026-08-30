/**
 * Frontend mirror of backend/src/lib/surface-profile.ts. Two copies + a drift
 * test (surface-profile-drift.test.ts), same rationale as cloud-only-nodes.ts.
 * The browser reads the already-validated profile from /config.js — no Zod
 * here; the backend is the authority.
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

/** B2b — the billing display surface (Phase B); see the backend twin. */
export interface SurfaceBilling {
  costTab: "inherit" | "hidden"
  unitLabel?: string
  unitRate?: number
  unitDecimals?: number
  selfServe: boolean
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
  billing: SurfaceBilling
  catalogPolicy?: unknown
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
  billing: { costTab: "inherit", selfServe: true },
}

function runtimeSurface(): Partial<SurfaceProfile> {
  return (typeof window !== "undefined" && window.__NODARO_RUNTIME__?.surface) || {}
}

/** The resolved profile the browser renders: window surface merged over the default. */
export function runtimeSurfaceProfile(): SurfaceProfile {
  const o = runtimeSurface()
  const d = SURFACE_PROFILE_DEFAULT
  return {
    nav: { ...d.nav, ...o.nav },
    dashboard: { ...d.dashboard, ...o.dashboard },
    nodes: { ...d.nodes, ...o.nodes },
    models: { ...d.models, ...o.models },
    auth: { ...d.auth, ...o.auth },
    siblings: { ...d.siblings, ...o.siblings },
    brand: { ...d.brand, ...o.brand },
    locale: { ...d.locale, ...o.locale },
    outputs: { ...d.outputs, ...o.outputs },
    voice: { ...d.voice, ...o.voice },
    billing: { ...d.billing, ...o.billing },
    catalogPolicy: o.catalogPolicy ?? d.catalogPolicy,
  }
}

/**
 * The raw brand product name a deployment ACTUALLY configured, or undefined
 * when none is set — the exact presence check the pre-paint script in
 * index.html uses (`s.brand && s.brand.productName`). Distinct from the merged
 * profile's `brand.productName`, which defaults to "Nodaro": a guard that must
 * leave the static <title>/<meta> byte-identical on a default (non-surface)
 * deployment reads this, never the defaulting surfaceBrandName(). Keep this
 * guard in lockstep with index.html's inline script.
 */
export function runtimeConfiguredBrandName(): string | undefined {
  return runtimeSurface().brand?.productName || undefined
}
