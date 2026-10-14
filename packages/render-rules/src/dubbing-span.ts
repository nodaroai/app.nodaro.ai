/**
 * How long a dub is, as a price reads it — the one rule the dubbing route, the
 * workflow run, the server's run estimate and the editor all apply.
 *
 * A dub is charged per started minute of its SPAN: the start/end window when
 * one is set (never longer than the source when its length is known), else
 * the whole source; at least one minute; a span past 30 minutes is refused,
 * never charged. The run measures the source itself; before a run, the
 * estimate and the editor read the length the graph tells (an upload's
 * recorded length, a render's output) and quote the started minutes of that
 * span under the dub's whole-request id (`<per-minute row>:<N>u`).
 */

/** The longest span a dub may cover, in whole minutes (the route refuses longer). */
export const DUBBING_MAX_SPAN_MINUTES = 30

/** The dubbed span in seconds: the start/end window when set (never longer
 *  than the source when its length is known), else the whole source. */
export function effectiveDubbedSeconds(probedSec: number | undefined, startTime?: number, endTime?: number): number | undefined {
  const window = startTime != null && endTime != null ? Math.ceil(endTime - startTime) : undefined
  if (window != null && window > 0) {
    return probedSec != null ? Math.min(probedSec, window) : window
  }
  return probedSec
}

/** Whole minutes a span is charged: rounded up, at least one. */
export function dubbingMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

/**
 * The started minutes a dub is QUOTED at before it runs, from the node's
 * settings and the source length the graph tells (`undefined` = not known):
 * the span's whole minutes, at most the 30 a dub may cover; one minute when
 * the span is not known (the run measures the source before it reserves).
 */
export function dubbingQuotedMinutes(
  data: { readonly startTime?: unknown; readonly endTime?: unknown },
  sourceSec: number | undefined,
): number {
  const known = sourceSec !== undefined && Number.isFinite(sourceSec) && sourceSec > 0 ? sourceSec : undefined
  const span = effectiveDubbedSeconds(
    known,
    typeof data.startTime === "number" && Number.isFinite(data.startTime) ? data.startTime : undefined,
    typeof data.endTime === "number" && Number.isFinite(data.endTime) ? data.endTime : undefined,
  )
  if (span === undefined || !(span > 0)) return 1
  return Math.min(DUBBING_MAX_SPAN_MINUTES, dubbingMinutes(span))
}

/**
 * The wire a dub takes its source from, by target handle: a wired `video`
 * wins over `audio` (the node dubs the video and ignores the audio), and a
 * `sourceUrl` set on the node replaces both — its length is not known before
 * the run measures the link. `undefined` when nothing is wired.
 */
export function dubbingSourceHandle(
  data: { readonly sourceUrl?: unknown },
  wiredHandles: ReadonlyArray<string | null | undefined>,
): "video" | "audio" | undefined {
  if (typeof data.sourceUrl === "string" && data.sourceUrl.trim() !== "") return undefined
  if (wiredHandles.includes("video")) return "video"
  if (wiredHandles.includes("audio")) return "audio"
  return undefined
}
