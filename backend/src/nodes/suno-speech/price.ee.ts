// Enterprise License (the .ee. filename). A price change ships with its
// model_pricing seed migration (supabase/migrations/NNN_*.sql) in the same PR:
// static-costs-match-migrations.test.ts holds the two together. Flat-priced: a
// run reserves its type's row. A unit priced by its settings adds creditId(data)
// here and the same rule in its frontend price-id.ts (tools/units/README.md).
import type { UnitPrice } from "../kit.js"

export const staticCosts = { "suno-speech": 30 } as const

export const price: UnitPrice = { staticCosts }
