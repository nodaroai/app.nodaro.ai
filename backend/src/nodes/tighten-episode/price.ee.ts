// backend/src/nodes/tighten-episode/price.ee.ts — Tighten Episode's per-run fee (Enterprise
// License, by filename). A run reserves its fee on the wrapper job; its steps bill as their own
// jobs, and an estimate expands it into them. The model_pricing row is seeded (migration 509).
export const staticCosts = { "use-case-fee:tighten-episode": 10 } as const
export const price = { staticCosts, creditId: () => "use-case-fee:tighten-episode" }
