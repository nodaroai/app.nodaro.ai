/**
 * Dubbing is priced per minute of the dubbed span. This module is the pure
 * half of that rule (no probing), read in three places:
 *
 *   1. before a run is reserved — the route's preHandler (`POST /v1/dubbing`)
 *      and the workflow run (node-executor) price the span they measured
 *      (lib/dubbing-duration.ts measures it);
 *   2. while it runs — the worker checks the 30-minute cap against
 *      ElevenLabs' own reading of a source we did not measure;
 *   3. when it is delivered — a run whose length could not be read before it
 *      started was held at the 30-minute ceiling, and `deliverDubbedMedia`
 *      settles it to the length that was actually dubbed.
 *
 * Kept free of the probes on purpose: delivery and the worker import it, and
 * neither may pull the yt-dlp lane into their module graph.
 */
import { DUBBING_MAX_DURATION_SEC } from "../providers/elevenlabs/dubbing.js"
import { baseCreditCostFor } from "./credit-base-cost.js"
import { dubbingModelIdentifier } from "./dubbing-model.js"
import { dubbingMinutes } from "@nodaro/render-rules"

// The span and its whole minutes: ONE rule with the server's run estimate and
// the editor, which quote a dub before it runs (`@nodaro/render-rules`).
export { effectiveDubbedSeconds, dubbingMinutes } from "@nodaro/render-rules"

/** What a dub holds: the span when it is known, else the 30-minute ceiling,
 *  which delivery settles down to the length actually dubbed. */
export interface DubbingReservePlan {
  readonly seconds: number
  readonly ceiling: boolean
}

export function dubbingReservePlan(spanSec: number | undefined): DubbingReservePlan {
  return spanSec != null && spanSec > 0
    ? { seconds: spanSec, ceiling: false }
    : { seconds: DUBBING_MAX_DURATION_SEC, ceiling: true }
}

/**
 * BASE (pre-markup) credits for dubbing `seconds` into `targetLanguage`: the
 * language's per-minute row (admin-editable in model_pricing) × whole minutes.
 * 0 when credits are off.
 */
export async function dubbingBaseCredits(targetLanguage: unknown, seconds: number): Promise<number> {
  return (await baseCreditCostFor(dubbingModelIdentifier(targetLanguage))) * dubbingMinutes(seconds)
}
