// Subject of the operator probe: a concise arrow body, arithmetic, unary
// minus and optional chaining — none of them a site of the first operator set.
export const sum = (a, b) => a + b

export const pick = (o) => o?.v.map((n) => -n)

export function twice(x) {
  return x * 2
}
