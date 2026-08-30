import {
  runtimeSurfaceProfile,
  runtimeConfiguredBrandName,
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

/**
 * The brand product name ONLY when a deployment actually configured one (raw
 * presence), else undefined — unlike surfaceBrandName(), which defaults to
 * "Nodaro". Mirrors the pre-paint guard in index.html so chrome that overrides
 * the document title/meta leaves the static values untouched on a default
 * deployment (byte-identical when the surface env is unset).
 */
export function surfaceConfiguredBrandName(): string | undefined {
  return runtimeConfiguredBrandName()
}

export function surfaceBrandDescription(): string | undefined {
  return runtimeSurfaceProfile().brand.description
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

// ── B2b — billing display surface (Phase B) ──────────────────────────────────
//
// The browser reads the profile the BACKEND resolved (/config.js is written from
// print-surface-profile — one parser), so a unit that reaches these selectors
// has already passed coherentBilling: both-or-neither, finite > 0, decimals in
// [0, 4], no-zero-lie, lossless. Defaults are the mainline literals ("CR", 1, 0)
// so an unconfigured deployment renders byte-identically.

/** The label a CLIENT-computed credit figure is rendered with. "CR" when no
 *  unit is configured. Figures that arrive from the billing seam carry their
 *  own unit (cost-summary `unit`, account `unit`) — render those with THAT. */
export function surfaceCreditUnitLabel(): string {
  return runtimeSurfaceProfile().billing.unitLabel ?? "CR"
}

/** Display units per 1 Nodaro credit; 1 when no unit is configured. */
export function surfaceCreditUnitRate(): number {
  return runtimeSurfaceProfile().billing.unitRate ?? 1
}

export function surfaceCreditUnitDecimals(): number {
  return runtimeSurfaceProfile().billing.unitDecimals ?? 0
}

/**
 * Convert a CLIENT-computed Nodaro-credit figure (NODE_CREDIT_COSTS, the run
 * estimate, a balance from /v1/user/credits) to the display unit, rounding
 * ONCE, here — never before summing (H12). Identity when no unit is
 * configured. `null`/`undefined` stay `null`: an authority's "could not say"
 * must never become a number (§5.2 rule 1); a site whose `undefined` means
 * "no estimate yet" decides that BEFORE calling this.
 */
export function surfaceCreditsToUnits(credits: number | null | undefined): number | null {
  if (credits == null || !Number.isFinite(credits)) return null
  const b = runtimeSurfaceProfile().billing
  if (b.unitRate === undefined) return credits
  const out = credits * b.unitRate
  if (!Number.isFinite(out)) return null
  const f = 10 ** (b.unitDecimals ?? 0)
  return Math.round(out * f) / f
}

/** false ⇒ no self-serve purchase: /pricing, /billing, buy-packs and every
 *  "buy credits" CTA are withheld (a prepaid instance's users must not be able
 *  to buy the platform's credits with a card). */
export function surfaceBillingSelfServe(): boolean {
  return runtimeSurfaceProfile().billing.selfServe
}

/** true ⇒ the canvas Cost tab is not mounted, whatever the billing surface says. */
export function surfaceCostTabHidden(): boolean {
  return runtimeSurfaceProfile().billing.costTab === "hidden"
}
