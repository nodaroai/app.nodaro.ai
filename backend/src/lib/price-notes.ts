import type { FastifyRequest } from "fastify"

/**
 * What a route's pricing tells a QUOTE about the number it computed — why the
 * price is what it is, and what the run should actually cost when that differs
 * from what it reserves. `POST /v1/quote` opens a notebook on the request
 * before running the route's own pricing; on a real run there is no notebook
 * and every note is dropped, so the run path is unchanged.
 *
 * Credits in a note are BASE (pre-markup), like the `computeCredits` return
 * they explain; the quote marks them up the same way the reservation is.
 */
export interface PriceNotes {
  /** BASE credits the run is expected to cost, when that is less than what it
   *  reserves and can be worked out from the measured inputs. */
  readonly expectedBase?: number
  readonly adjustments: readonly PriceAdjustmentNote[]
  readonly warnings: readonly PriceWarningNote[]
}

export interface PriceAdjustmentNote {
  readonly code: string
  readonly message: string
  /** BASE credits this adjustment adds, when it is a separate amount. */
  readonly baseCredits?: number
}

export interface PriceWarningNote {
  readonly code: string
  readonly message: string
}

declare module "fastify" {
  interface FastifyRequest {
    /** Open only while `POST /v1/quote` prices a body (see {@link PriceNotes}). */
    priceNotes?: PriceNotes
  }
}

export const EMPTY_PRICE_NOTES: PriceNotes = { adjustments: [], warnings: [] }

/** True while a quote is pricing this request — lets a route skip work only a
 *  quote needs (e.g. the expected-cost arithmetic). */
export function isQuoting(req: FastifyRequest): boolean {
  return req.priceNotes !== undefined
}

export function noteAdjustment(req: FastifyRequest, note: PriceAdjustmentNote): void {
  const notes = req.priceNotes
  if (notes) req.priceNotes = { ...notes, adjustments: [...notes.adjustments, note] }
}

export function noteWarning(req: FastifyRequest, note: PriceWarningNote): void {
  const notes = req.priceNotes
  if (notes) req.priceNotes = { ...notes, warnings: [...notes.warnings, note] }
}

export function noteExpectedBase(req: FastifyRequest, expectedBase: number): void {
  const notes = req.priceNotes
  if (notes) req.priceNotes = { ...notes, expectedBase }
}
