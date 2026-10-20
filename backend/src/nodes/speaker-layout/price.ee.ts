// Speaker Layout's per-run fee (Enterprise License, by filename). A run reserves its fee on the
// wrapper job; its steps bill as their own jobs at their own rows, and an estimate expands it
// into them. A price change ships with its model_pricing seed migration
// (supabase/migrations/NNN_*.sql) in the same PR: static-costs-match-migrations.test.ts holds
// the two together.
import type { UnitPrice } from "../kit.js"

export const staticCosts = { "use-case-fee:speaker-layout": 10 } as const

export const price: UnitPrice = { staticCosts, creditId: () => "use-case-fee:speaker-layout" }
