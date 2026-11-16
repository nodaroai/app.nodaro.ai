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
import { dubbingHeldMinutes } from "@nodaro/render-rules"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { withinCapGrace } from "./measured-cap-grace.js"

// The span and its whole minutes: ONE rule with the server's run estimate and
// the editor, which quote a dub before it runs (`@nodaro/render-rules`).
export { effectiveDubbedSeconds, dubbingHeldMinutes, dubbingMinutes } from "@nodaro/render-rules"

/** What a dub holds: the span when it is known, else the 30-minute ceiling,
 *  which delivery settles down to the length actually dubbed. */
export interface DubbingReservePlan {
  readonly seconds: number
  readonly ceiling: boolean
}

/** A measured span held to the 30-minute cap: what the run holds, and the window that cuts it to the cap. */
export interface DubbingSpanAtCap {
  /** The span the run holds and dubs: at most the cap. */
  readonly spanSec: number
  /** A span a hair past the cap: the window that cuts it to the cap (never wider than one the request set). */
  readonly window?: { readonly startTime: number; readonly endTime: number }
}

/**
 * A measured span (`effectiveDubbedSeconds`) held to the 30-minute cap
 * ({@link DUBBING_MAX_DURATION_SEC}): up to the 0.05 s its hold and charge
 * forgive past a minute (`CLIP_PRICE_GRACE_SEC`) past the cap, accepted —
 * held at 30 minutes, the top of its quote — and, when what would be dubbed
 * runs past the cap, dubbed through a window that cuts it to the cap (the
 * start, or 0, to that plus the cap, never past an end the request set).
 * Further past the cap: `undefined`, the route's refusal. A dub into a
 * language dubbed as a project takes no window, so it keeps the strict cap
 * (`strict`).
 *
 * What is dubbed, from the span `effectiveDubbedSeconds` read (the source's
 * whole length unless the request set both ends): a full window's span; from
 * a start only, the source less that start; to an end only, up to that end.
 */
export function dubbingSpanAtCap(spanSec: number, startTime: number | undefined, endTime: number | undefined, strict = false): DubbingSpanAtCap | undefined {
  if (spanSec <= DUBBING_MAX_DURATION_SEC) return { spanSec }
  if (strict || !withinCapGrace(spanSec, DUBBING_MAX_DURATION_SEC, CLIP_PRICE_GRACE_SEC)) return undefined
  const dubbedSec = startTime != null && endTime != null ? spanSec
    : startTime != null ? spanSec - startTime
    : endTime != null ? Math.min(endTime, spanSec)
    : spanSec
  if (dubbedSec <= DUBBING_MAX_DURATION_SEC) return { spanSec: DUBBING_MAX_DURATION_SEC }
  const start = startTime ?? 0
  return { spanSec: DUBBING_MAX_DURATION_SEC, window: { startTime: start, endTime: Math.min(endTime ?? Number.POSITIVE_INFINITY, start + DUBBING_MAX_DURATION_SEC) } }
}

export function dubbingReservePlan(spanSec: number | undefined): DubbingReservePlan {
  return spanSec != null && spanSec > 0
    ? { seconds: spanSec, ceiling: false }
    : { seconds: DUBBING_MAX_DURATION_SEC, ceiling: true }
}

/**
 * BASE (pre-markup) credits for dubbing `seconds` into `targetLanguage`: the
 * language's per-minute row (admin-editable in model_pricing) × the whole
 * minutes a measured span is held and charged (`dubbingHeldMinutes`: a hair
 * past a minute forgiven, decided 2026-11-14). 0 when credits are off.
 */
export async function dubbingBaseCredits(targetLanguage: unknown, seconds: number): Promise<number> {
  return dubbingBaseCreditsFor(dubbingModelIdentifier(targetLanguage), seconds)
}

/**
 * The same price for a dub whose row is already known: a language added to a
 * project dub is charged on the project's row, whatever language it speaks —
 * by the same held minutes (`dubbingHeldMinutes`).
 */
export async function dubbingBaseCreditsFor(modelId: string, seconds: number): Promise<number> {
  return (await baseCreditCostFor(modelId)) * dubbingHeldMinutes(seconds)
}
