// Gif to Video's credit row (Enterprise License, by filename). Zero credits by
// design — a local FFmpeg conversion with no provider cost, a free bridge that
// lets a GIF be used as a motion reference for models that reject GIF input.
// Flat-priced: a run reserves the "gif-to-video" row, so there is no creditId
// resolver. The model_pricing seed (supabase/migrations/354) carries the same value.
export const staticCosts = { "gif-to-video": 0 } as const

export const price = { staticCosts }
