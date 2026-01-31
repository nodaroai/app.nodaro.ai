export type Edition = 'self-hosted' | 'cloud'

export const EDITION: Edition = (process.env.NEXT_PUBLIC_EDITION as Edition) || 'self-hosted'

export const features = {
  adminPanel: EDITION === 'cloud',
  usersManagement: EDITION === 'cloud',
  creditsSystem: EDITION === 'cloud',
  billing: EDITION === 'cloud',
  multiTenancy: EDITION === 'cloud',
} as const

export function isFeatureEnabled(feature: keyof typeof features): boolean {
  return features[feature]
}
