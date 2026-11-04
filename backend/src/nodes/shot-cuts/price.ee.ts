// Shot Cuts' credit row (Enterprise License, by filename). Flat-priced, with or
// without frames: a run reserves the type's own row, so there is no creditId
// resolver. The model_pricing seed (supabase/migrations) carries the same value
// (static-costs-match-migrations.test.ts holds the two together).
import type { UnitPrice } from "../kit.js"

export const staticCosts = { "shot-cuts": 1 } as const

export const price: UnitPrice = { staticCosts }
