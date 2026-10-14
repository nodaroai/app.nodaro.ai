/**
 * The quote key of a Seedance 2 reference-video quote — `seedance-ref-quote:`
 * plus the request as JSON. Kept apart from `seedance-ref-quote.ts` (which reads
 * the graph through the run's input resolver) so the price cache can recognise
 * and parse a key without importing the editor.
 */
import type { SeedanceRefEstimateRequest } from "@/lib/api"

export const SEEDANCE_REF_QUOTE_PREFIX = "seedance-ref-quote:"

/** The request as a price-cache key (stable field order). */
export function seedanceRefQuoteKey(request: SeedanceRefEstimateRequest): string {
  return SEEDANCE_REF_QUOTE_PREFIX + JSON.stringify({
    provider: request.provider,
    resolution: request.resolution,
    duration: request.duration,
    draft: request.draft,
    referenceVideoUrls: request.referenceVideoUrls,
    unknownReferenceVideos: request.unknownReferenceVideos,
  })
}

export function isSeedanceRefQuoteKey(key: string): boolean {
  return key.startsWith(SEEDANCE_REF_QUOTE_PREFIX)
}

/** The request a quote key names, or undefined for any other id. */
export function parseSeedanceRefQuoteKey(key: string): SeedanceRefEstimateRequest | undefined {
  if (!isSeedanceRefQuoteKey(key)) return undefined
  try {
    const parsed = JSON.parse(key.slice(SEEDANCE_REF_QUOTE_PREFIX.length)) as SeedanceRefEstimateRequest
    return parsed && typeof parsed.provider === "string" && Array.isArray(parsed.referenceVideoUrls) ? parsed : undefined
  } catch {
    return undefined
  }
}
