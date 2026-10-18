export const staticCosts = { "use-case-fee:fixture-case": 1 } as const

export function creditId() {
  return "use-case-fee:fixture-case"
}

export const price = { staticCosts, creditId }
