/**
 * A listing (a publish, a republish, a listing backfill) whose UGC video could not be priced: its
 * estimate failed for the saved settings or for a choice the app's user can make. A listing never
 * prices such a video as free: it is refused, naming the choice (`lib/listing-refusal.ts` answers
 * it, recognised by name). A run's estimate is not refused: it counts the part as 0 and warns.
 */
import type { UgcEstimateInput } from "@nodaro/render-rules"

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: "English", he: "Hebrew" }

/** The choice an input stands for, in words: its language and length. */
export function describeUgcInput(input: UgcEstimateInput): string {
  return `${LANGUAGE_NAMES[input.language ?? "en"] ?? input.language}, ${input.targetDurationSec} s`
}

export class UgcListingUnpricedError extends Error {
  readonly code = "ugc_listing_unpriced" as const
  /** Which choice could not be priced, in words: "its saved settings (English, 20 s)", "a choice its users can make (Hebrew, 60 s)". */
  readonly choice: string

  /** `input`: the estimate input that failed; absent when the part failed before any was asked. */
  constructor(where: "saved" | "choice", input: UgcEstimateInput | undefined, options?: { cause?: unknown }) {
    const detail = input ? ` (${describeUgcInput(input)})` : ""
    const choice = where === "saved" ? `its saved settings${detail}` : `a choice its users can make${detail}`
    super(`Couldn't price this workflow's UGC video ${where === "saved" ? "at" : "for"} ${choice}. Try publishing again.`, options)
    this.name = "UgcListingUnpricedError"
    this.choice = choice
  }
}

/** A UGC estimate that failed while a listing asked it: the input it failed on (thrown only in a listing's strict reading). */
export class UgcPartUnpricedError extends Error {
  /** `input`: the estimate input being asked when it failed; absent when nothing was asked yet. */
  constructor(readonly input: UgcEstimateInput | undefined, options?: { cause?: unknown }) {
    super("The UGC estimate failed", options)
    this.name = "UgcPartUnpricedError"
  }
}
