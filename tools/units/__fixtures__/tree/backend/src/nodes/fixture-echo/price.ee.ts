export const staticCosts = { "fixture-echo": 3 } as const

export function creditId() {
  return "fixture-echo"
}

export const price = { staticCosts, creditId }
