/**
 * Calculate the creator's monetization markup on a base credit cost.
 * Returns the markup amount (not the total).
 */
export function calculateMonetizationMarkup(baseCost: number, flatFee: number, percent: number): number {
  if (flatFee <= 0 && percent <= 0) return 0
  return flatFee + Math.ceil(baseCost * percent / 100)
}

/**
 * Calculate the total cost a runner pays (base + markup).
 */
export function calculateMonetizedCost(baseCost: number, flatFee: number, percent: number): number {
  return baseCost + calculateMonetizationMarkup(baseCost, flatFee, percent)
}
