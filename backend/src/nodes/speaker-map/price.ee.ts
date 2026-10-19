// Speaker Map's credit row (Enterprise License, by filename). Flat-priced: a
// run reserves the "speaker-map" row, so there is no creditId resolver. The
// model_pricing seed (supabase/migrations) carries the same value.
export const staticCosts = { "speaker-map": 10 } as const

export const price = { staticCosts }
