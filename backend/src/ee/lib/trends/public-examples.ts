/**
 * A trend's examples as the public sees them (pure).
 *
 * A trend version that hides its original (`hideOriginal`) shows its stored
 * Example 1 AS the original, and lists its examples from stored Example 2. So
 * every public number names an example in the list the trend page shows:
 *
 *   public example n      = stored example n + 1   (hidden)
 *   no example asked for  = stored example 1       (hidden: the one shown as the original)
 *   public example n      = stored example n       (shown: unchanged)
 *
 * A run is composed and stored in the STORED numbering (`composeTrendRun`,
 * the job's `input_data.example`); only the public routes translate, in on a
 * run request (`storedExampleRequest`) and back out on a run read
 * (`publicExampleOf`, against the version the run ran on). Admin routes use
 * the stored numbering throughout: they list every example.
 */
import { TrendRunError } from "./compose.js"
import type { TrendExample, TrendSourceDisplay, TrendVersionData } from "./types.js"

/** Whether this version hides its original clip. */
export function hidesOriginal(data: Pick<TrendVersionData, "hideOriginal">): boolean {
  return data.hideOriginal === true
}

/**
 * What every public response shows as the trend's original: the source's
 * display copy, or, on a version that hides its original, stored Example 1 —
 * never the display copy then, so it never leaves the server. Undefined when
 * there is neither.
 */
export function shownOriginal(data: TrendVersionData): TrendExample | TrendSourceDisplay | undefined {
  if (hidesOriginal(data)) return data.examples[0]
  return data.source?.display
}

/** The examples a public response lists: from stored Example 2 on a version that hides its original. */
export function listedExamples(data: TrendVersionData): TrendExample[] {
  return hidesOriginal(data) ? data.examples.slice(1) : data.examples
}

/**
 * A public run request's `example` in the stored numbering `composeTrendRun`
 * reads. Shown original: as given. Hidden original: n → n + 1, checked against
 * the PUBLIC list (at most the stored count − 1: `example_out_of_range`
 * otherwise, naming the number asked for), and none asked for → stored 1 (the
 * example shown as the original), or none at all on a version with no example
 * (which cannot be published so).
 */
export function storedExampleRequest(data: TrendVersionData, example: number | undefined): number | undefined {
  if (!hidesOriginal(data)) return example
  if (example === undefined) return data.examples.length > 0 ? 1 : undefined
  const listed = data.examples.length - 1
  if (!Number.isInteger(example) || example < 1 || example > listed) {
    throw new TrendRunError("example_out_of_range", `This trend has no example ${example}.`)
  }
  return example + 1
}

/**
 * A stored run's `example` in the public numbering of the version it ran on.
 * Shown original: as stored. Hidden original: stored k ≥ 2 → k − 1, and
 * stored 1 (the example shown as the original) → undefined, so the public run
 * names no example. 0 (none was used) stays 0.
 */
export function publicExampleOf(stored: number, versionHidesOriginal: boolean): number | undefined {
  if (!versionHidesOriginal || stored === 0) return stored
  return stored === 1 ? undefined : stored - 1
}
