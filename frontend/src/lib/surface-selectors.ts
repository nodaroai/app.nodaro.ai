import {
  runtimeSurfaceProfile,
  type NavKey,
  type DashboardTabKey,
  type AuthMethod,
  type SurfaceSibling,
} from "./surface-profile"

/**
 * Pure narrowing selectors — the funnel every UI surface reads a deployment
 * override through. Narrowing by construction: an empty profile array means
 * "inherit the code default"; a non-empty one narrows to exactly that set. A
 * selector can only hide/deny/whitelist relative to what the code renders.
 */

export function surfaceNavHidden(key: NavKey): boolean {
  return runtimeSurfaceProfile().nav.hide.includes(key)
}

export function surfaceTabs<T extends DashboardTabKey>(codeDefault: readonly T[]): readonly T[] {
  const tabs = runtimeSurfaceProfile().dashboard.tabs
  if (!tabs.length) return codeDefault
  // Whitelist ∩ code default, kept in the profile's order.
  return tabs.filter((k): k is T => (codeDefault as readonly DashboardTabKey[]).includes(k))
}

export function surfaceSiblings(codeDefault: readonly SurfaceSibling[]): readonly SurfaceSibling[] {
  const s = runtimeSurfaceProfile().siblings.apps
  return s.length ? s : codeDefault
}

export function surfaceBrandName(): string {
  return runtimeSurfaceProfile().brand.productName
}

export function surfaceAuthMethods(codeDefault: readonly AuthMethod[]): readonly AuthMethod[] {
  const m = runtimeSurfaceProfile().auth.methods
  if (!m.length) return codeDefault
  // Narrow to methods the code actually offers (N3: no "sso" widen exception —
  // a method the code doesn't render can never be surfaced; when SSO ships, the
  // login page adds it to its own code default). S4: an EMPTY intersection would
  // strand the login page with zero auth methods, so fall back to the code
  // default (mirrors effectiveWorkspaceTab's tabs fallback in projects/page.tsx).
  const narrowed = m.filter((x) => codeDefault.includes(x))
  return narrowed.length ? narrowed : codeDefault
}

export function surfaceAuthSsoLabel(): string | undefined {
  return runtimeSurfaceProfile().auth.ssoLabel
}

export function surfaceOutputsAllowPublic(): boolean {
  return runtimeSurfaceProfile().outputs.allowPublic
}

export function surfaceLocaleDefault(): string | undefined {
  return runtimeSurfaceProfile().locale.default
}

export function surfaceLocalePicker(): boolean {
  return runtimeSurfaceProfile().locale.picker
}
