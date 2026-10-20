/**
 * "Cheap lanes only" — the per-request opt-out of the direct-vendor fallback
 * (`LlmRequest.cheapLanesOnly`), as an LLM route takes it.
 *
 * A scheduled run under a "retry on failure" policy with `cheapLanesOnly`
 * (decided 2026-10-20) must never pay the vendor's own API for a call KIE
 * failed: the orchestrator sets the flag on the run, the LLM routes accept it
 * in their body (`LLM_CHEAP_LANES_SHAPE`), the worker handlers read it off
 * their payload, and every one hands it to the client with `cheapLanesParam`.
 * Only ever reduces spend, so a caller sending it by hand is harmless; absent
 * is today's routing, byte for byte.
 */

import { z } from "zod"

/** Spread into a route's body schema beside `LLM_ADVANCED_SHAPE`. */
export const LLM_CHEAP_LANES_SHAPE = {
  cheapLanesOnly: z.boolean().optional(),
}

export interface LlmCheapLanesInput {
  cheapLanesOnly?: boolean
}

/** The `LlmRequest` slice: `{ cheapLanesOnly: true }` when asked, nothing otherwise. */
export function cheapLanesParam(input: LlmCheapLanesInput | undefined): { cheapLanesOnly?: true } {
  return input?.cheapLanesOnly === true ? { cheapLanesOnly: true } : {}
}
