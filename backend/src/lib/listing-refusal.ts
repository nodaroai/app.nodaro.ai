/**
 * A listing refused rather than priced (a publish, a republish, a listing backfill): a metered LLM
 * model with no price (`llm_model_unpriced`, R49 — `llm-unpriced-refusal.ts`), or a UGC video whose
 * estimate failed for the saved settings or a choice the app's user can make
 * (`ugc_listing_unpriced`, `ee/billing/ugc-listing-unpriced.ts`) — never listed as free.
 *
 * Core: the errors are recognised by their names (core never imports `ee/` statically).
 */
import type { FastifyReply } from "fastify"
import { isLlmUnpricedError, replyIfLlmUnpriced } from "./llm-unpriced-refusal.js"

/** The listing's refusal of a UGC video it could not price, recognised without importing `ee/`. */
export interface UgcListingUnpricedError extends Error {
  readonly code: "ugc_listing_unpriced"
  /** The choice that could not be priced, in words. */
  readonly choice: string
}

export function isUgcListingUnpricedError(err: unknown): err is UgcListingUnpricedError {
  return err instanceof Error && err.name === "UgcListingUnpricedError"
}

/**
 * Answer a listing's refusal: an unpriced LLM model's 400, or `503 ugc_listing_unpriced` for a UGC
 * video whose estimate failed (`{ error: { code, reason, choice, message } }` — try again). False (nothing
 * sent) for any other error.
 */
export async function replyIfListingRefused(reply: FastifyReply, err: unknown): Promise<boolean> {
  if (await replyIfLlmUnpriced(reply, err)) return true
  if (!isUgcListingUnpricedError(err)) return false
  // `reason` names it as the unpriced-model refusal names its own, for a client keyed on `error.reason`.
  reply.status(503).send({ error: { code: err.code, reason: err.code, choice: err.choice, message: err.message } })
  return true
}

/** Why a backfill leaves a row as stored (a listing refusal), or null when `err` is not one. */
export function listingRefusalSkip(err: unknown): string | null {
  if (isLlmUnpricedError(err)) return `llm_model_unpriced: ${err.modelId}`
  if (isUgcListingUnpricedError(err)) return `ugc_listing_unpriced: ${err.choice}`
  return null
}
