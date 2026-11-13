import { canonicalVideoProvider } from "@nodaro/shared/models"

/**
 * The id `identifier` is priced as: an id naming a retired video model
 * (`RETIRED_VIDEO_PROVIDERS`, its first `:` segment) spelled with the model it
 * runs as — `seedance-2-extend:8s:720p` is `seedance-2-5-extend:8s:720p` —
 * and every other id as it is. A retired model runs as that model, so every
 * price read (the single lookup and the batch table, `ee/billing/credits.ts`)
 * and every markup (the margin lookup, `ee/billing/service-margin.ts`) reads
 * the id it runs as: a quote, a reservation and a settle that name the old
 * spelling agree with each other and with the model it runs as, and a stale
 * row or margin left under the old spelling is never read.
 */
export function pricedAsId(identifier: string): string {
  const colon = identifier.indexOf(":")
  const model = colon === -1 ? identifier : identifier.slice(0, colon)
  const runsAs = canonicalVideoProvider(model)
  return runsAs === model ? identifier : `${runsAs}${identifier.slice(model.length)}`
}
