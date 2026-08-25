/**
 * Frontend mirror of backend/src/lib/surface-profile.ts. Two copies + a drift
 * test (surface-profile-drift.test.ts), same rationale as cloud-only-nodes.ts.
 * The browser reads the already-validated profile from /config.js — no Zod
 * here; the backend is the authority.
 */
export type NavKey = "gallery" | "explore" | "pricing" | "templates" | "apps" | "community"
export type DashboardTabKey = "workflows" | "projects" | "apps" | "templates" | "gallery"
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
  brand: { productName: string }
  locale: { default?: string; picker: boolean }
  outputs: { allowPublic: boolean }
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
    catalogPolicy: o.catalogPolicy ?? d.catalogPolicy,
  }
}
