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
