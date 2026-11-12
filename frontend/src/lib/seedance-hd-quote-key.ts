/**
 * The quote key of a Seedance 2.5 HD finalize of a draft not made yet —
 * `seedance-hd-quote:` plus the draft's request as JSON. The server prices it
 * (`POST /v1/credits/seedance-hd-estimate` with `plannedDraft`): a draft with
 * reference videos is finalized at a per-second rate over its clips plus its
 * take, which no single price row expresses. Kept apart from
 * `seedance-hd-quote.ts` (which reads the graph) so the price cache can
 * recognise and parse a key without importing the editor.
 */
import type { SeedancePlannedDraftRequest } from "@/lib/api"

export const SEEDANCE_HD_QUOTE_PREFIX = "seedance-hd-quote:"

/** The planned draft as a price-cache key (stable field order). */
export function seedanceHdQuoteKey(draft: SeedancePlannedDraftRequest): string {
  return SEEDANCE_HD_QUOTE_PREFIX + JSON.stringify({
    provider: draft.provider,
    resolution: draft.resolution,
    duration: draft.duration,
    draft: draft.draft,
    referenceTaskType: draft.referenceTaskType,
    referenceVideoUrls: draft.referenceVideoUrls,
    unknownReferenceVideos: draft.unknownReferenceVideos,
  })
}

export function isSeedanceHdQuoteKey(key: string): boolean {
  return key.startsWith(SEEDANCE_HD_QUOTE_PREFIX)
}

/** The planned draft a quote key names, or undefined for any other id. */
export function parseSeedanceHdQuoteKey(key: string): SeedancePlannedDraftRequest | undefined {
  if (!isSeedanceHdQuoteKey(key)) return undefined
  try {
    const parsed = JSON.parse(key.slice(SEEDANCE_HD_QUOTE_PREFIX.length)) as SeedancePlannedDraftRequest
    return parsed && typeof parsed.provider === "string" && Array.isArray(parsed.referenceVideoUrls) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The key of the exact finalize price of a draft that already exists — what a
 * run that only finalizes it is priced at (decided 2026-11-12) — named by the
 * draft's provider task id, the id the run's finalize sends. Its price is the
 * one the Seedance 2.5 HD node's pill reads (`seedanceHdDraft(taskId)`), so
 * the two share one request per draft.
 */
export const SEEDANCE_HD_DRAFT_PREFIX = "seedance-hd-draft:"

export function seedanceHdDraftKey(taskId: string): string {
  return SEEDANCE_HD_DRAFT_PREFIX + taskId
}

export function isSeedanceHdDraftKey(key: string): boolean {
  return key.startsWith(SEEDANCE_HD_DRAFT_PREFIX) && key.length > SEEDANCE_HD_DRAFT_PREFIX.length
}

/** The task id a draft key names, or undefined for any other id. */
export function parseSeedanceHdDraftKey(key: string): string | undefined {
  return isSeedanceHdDraftKey(key) ? key.slice(SEEDANCE_HD_DRAFT_PREFIX.length) : undefined
}
