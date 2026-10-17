// Remove Audio's credit row (Enterprise License, by filename). Flat-priced: a
// run reserves the "remove-audio" row, so there is no creditId resolver. The
// model_pricing seed (supabase/migrations) carries the same value.
export const staticCosts = { "remove-audio": 20 } as const

export const price = { staticCosts }
