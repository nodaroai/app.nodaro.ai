export type Edition = 'community' | 'business' | 'cloud'

export const EDITION: Edition = (process.env.NEXT_PUBLIC_EDITION as Edition) || 'community'

/** community = open source, no credits, no admin */
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

export const features = {
  adminPanel: hasAdmin(),
  usersManagement: hasUserManagement(),
  creditsSystem: hasCredits(),
  billing: hasCredits(),
  multiTenancy: hasCredits(),
  providerSelection: isCloud(),
  costMarkup: isCloud(),
} as const

export function isFeatureEnabled(feature: keyof typeof features): boolean {
  return features[feature]
}
