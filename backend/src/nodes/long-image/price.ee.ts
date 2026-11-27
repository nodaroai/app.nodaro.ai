// Long Image's credit rows (Enterprise License, by filename; prices decided
// 2026-11-22, provisional until measured). A run is charged the row of its
// mode, its length (a product page), its size and the pictures it sends
// (@nodaro/render-rules longImageCreditId): the reservation is the charge, one
// picture per run. Each row is the base its provider figure converts to for
// that run, the pictures included, rounded up once (price.test.ts holds every
// row to the figures in providers/kie/models.ts). The bare row is the default
// run (a webpage design at 2K with no picture). The model_pricing seed
// (supabase/migrations) carries the same values (static-costs-match-migrations.test.ts
// holds the two together).
import { longImageDataCreditId, longImageWiredCreditId } from "@nodaro/render-rules"
import type { UnitPrice } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

export const staticCosts = {
  "long-image": 269,
  "long-image:webpage:1K": 248,
  "long-image:webpage:1K:1ref": 249,
  "long-image:webpage:1K:2ref": 250,
  "long-image:webpage:2K": 269,
  "long-image:webpage:2K:1ref": 270,
  "long-image:webpage:2K:2ref": 272,
  "long-image:ecommerce:short:1K:1ref": 108,
  "long-image:ecommerce:short:1K:2ref": 109,
  "long-image:ecommerce:short:1K:3ref": 110,
  "long-image:ecommerce:short:2K:1ref": 129,
  "long-image:ecommerce:short:2K:2ref": 130,
  "long-image:ecommerce:short:2K:3ref": 132,
  "long-image:ecommerce:medium:1K:1ref": 213,
  "long-image:ecommerce:medium:1K:2ref": 214,
  "long-image:ecommerce:medium:1K:3ref": 215,
  "long-image:ecommerce:medium:2K:1ref": 249,
  "long-image:ecommerce:medium:2K:2ref": 250,
  "long-image:ecommerce:medium:2K:3ref": 252,
  "long-image:ecommerce:long:1K:1ref": 354,
  "long-image:ecommerce:long:1K:2ref": 355,
  "long-image:ecommerce:long:1K:3ref": 357,
  "long-image:ecommerce:long:2K:1ref": 389,
  "long-image:ecommerce:long:2K:2ref": 390,
  "long-image:ecommerce:long:2K:3ref": 392,
} as const

export const price: UnitPrice = {
  staticCosts,
  // The row a run of the node's data or a job's request is charged. With the
  // graph (a run estimate: `wiredInputs`), each wired picture input of the mode
  // counts as one picture, as the editor counts them (price-id.ts). Without it,
  // a node's data holds no wired picture, so it is priced on the most its mode
  // can send (never below the run); a job's request states the pictures it sends.
  creditId: (data, wiredInputs) => (wiredInputs ? longImageWiredCreditId(descriptor.type, data, wiredInputs) : longImageDataCreditId(descriptor.type, data)),
}
