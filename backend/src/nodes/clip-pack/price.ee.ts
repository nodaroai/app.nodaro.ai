// backend/src/nodes/clip-pack/price.ee.ts — Clip Pack's per-run fee (Enterprise License, by
// filename). A run reserves its fee on the wrapper job; its steps bill as their own jobs, and an
// estimate expands it into them. The model_pricing row is seeded (migration 531).
export const staticCosts = { "use-case-fee:clip-pack": 10 } as const
export const price = { staticCosts, creditId: () => "use-case-fee:clip-pack" }
