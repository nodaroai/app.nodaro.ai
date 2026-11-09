export type Edition = 'community' | 'business' | 'cloud'

export const EDITION: Edition = (import.meta.env.VITE_EDITION as Edition) || 'community'

/** community = source-available self-host, no credits, no admin */
export function isCommunity(): boolean {
  return EDITION === 'community'
}

/** business = self-hosted with admin, user mgmt, no credits */
export function isBusiness(): boolean {
  return EDITION === 'business'
}

/** cloud = full SaaS with credits, billing, markup */
export function isCloud(): boolean {
  return EDITION === 'cloud'
}

/** business + cloud have admin panel */
export function hasAdmin(): boolean {
  return EDITION === 'business' || EDITION === 'cloud'
}

/** only cloud edition has credit system */
export function hasCredits(): boolean {
  return EDITION === 'cloud'
}

/** business + cloud have user management */
export function hasUserManagement(): boolean {
  return EDITION === 'business' || EDITION === 'cloud'
}

/**
 * Organizations — the second tenancy axis. Twin of the backend's
 * `hasOrganizations()`: cloud edition AND the launch flag. Off everywhere
 * until the flag is thrown, so every organization surface is absent rather
 * than empty on a build without it.
 *
 * Inlined by Vite at BUILD time, which is why the Dockerfile must carry both
 * an ARG and an ENV for it — a missing pair yields `undefined` and the
 * feature silently stays off in a build that meant to have it.
 */
export const ORGS_ENABLED = import.meta.env.VITE_ORGS_ENABLED === "true"

export function hasOrganizations(): boolean {
  return isCloud() && ORGS_ENABLED
}

/**
 * Shared site header (Cloud), build-time like ORGS_ENABLED (Dockerfile ARG +
 * ENV):
 *   - "true" puts the shared Nodaro header above the app (staging), or a
 *     white-label one where the deployment's surface profile asks for it;
 *   - "white-label" builds the header in for deployments of their own: it
 *     shows only where the surface profile says `header: "white-label"`, and
 *     Nodaro's header never does (the cloud image those deployments run);
 *   - empty = off, which is every self-host build and Nodaro production until
 *     the cut-over.
 * The build's resolver forces it to "false" whenever the header itself is not
 * in the bundle (see `ee/shell/header-module-plugin.ts`), so either value here
 * means the header is there. Which header a page shows, if any, is decided at
 * run time (`lib/site-header-mode.ts`).
 */
export const SHARED_HEADER = import.meta.env.VITE_SHARED_HEADER === "true"
export const WHITE_LABEL_HEADER = SHARED_HEADER || import.meta.env.VITE_SHARED_HEADER === "white-label"

/** The build may show Nodaro's own shared header. */
export function hasSharedHeader(): boolean {
  return isCloud() && hasCredits() && SHARED_HEADER
}

/** The build may show the shared header in white-label mode (a deployment's own header). */
export function hasWhiteLabelHeader(): boolean {
  return isCloud() && hasCredits() && WHITE_LABEL_HEADER
}

/** business + cloud are multi-user (community is single-user → sharing is inert) */
export function isMultiUser(): boolean {
  return EDITION === 'business' || EDITION === 'cloud'
}

export const features = {
  adminPanel: hasAdmin(),
  usersManagement: hasUserManagement(),
  creditsSystem: hasCredits(),
  billing: hasCredits(),
  multiTenancy: hasCredits(),
  organizations: hasOrganizations(),
  providerSelection: isCloud(),
  costMarkup: isCloud(),
} as const

export function isFeatureEnabled(feature: keyof typeof features): boolean {
  return features[feature]
}
