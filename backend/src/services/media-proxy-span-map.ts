/**
 * THE DETECTION PROXY'S CLOCK — the span map (P3.2; plan §0.11).
 *
 * A span-scoped video proxy is the kept spans of a source, each re-sampled at
 * `fps` and laid end to end. A frame's place in the proxy says nothing about
 * where it came from in the source, and the detector reads the proxy and
 * returns a FRAME INDEX with no timestamp. The span map is therefore the only
 * clock a detection has: every box goes through it before anything else
 * touches it, and one that falls in no row is dropped (and counted), never
 * guessed.
 *
 * The map is built from the frames the encoder actually WROTE (ffprobe of each
 * segment and of the joined proxy), never from the requested span bounds, so
 * the frame-count rounding at `fps` and a VFR source are absorbed here, not by
 * every consumer.
 *
 * One row per span that wrote frames:
 *   - frames `[firstFrame, firstFrame + frameCount)` of the proxy,
 *   - proxy time `[proxyStartMs, proxyEndMs)`,
 *   - frame `firstFrame + k` shows what is on screen at source time
 *     `sourceStartMs + k × 1000 / fps` (to within one SOURCE frame: a seek
 *     lands on the first frame at or after its point). `sourceStartMs` is the
 *     segment's first WRITTEN sample, which can sit a period or more after the
 *     span's start (a late seek landing, a span starting in a VFR hole) — the
 *     encoder never back-fills the grid before the first decoded frame.
 *
 * Times are unrounded milliseconds on purpose: at 7.5 or 29.97 fps a frame
 * period is a fraction of a millisecond off a whole number, and a rounded row
 * bound is exactly what puts a join's frame in the wrong row.
 *
 * Pure: no I/O. Handed to plugins as `tk.media.proxyFrameToSourceMs`, so the
 * plugin converts through this function, not a copy of it.
 */
import { DeterministicJobError } from "../lib/deterministic-job-error.js"

/** A stretch of the source to sample, in ms on the SOURCE's own clock. */
export interface ProxySpan {
  readonly startMs: number
  readonly endMs: number
}

/** One span of the proxy, and where it sits on the source clock. */
export interface ProxySpanMapRow {
  readonly proxyStartMs: number
  /** Exclusive: the last frame's time plus one frame period. */
  readonly proxyEndMs: number
  readonly sourceStartMs: number
  /** Index of the row's first frame in the proxy. */
  readonly firstFrame: number
  readonly frameCount: number
}

export type ProxySpanMap = readonly ProxySpanMapRow[]

/**
 * The detection proxy's starting values — decided 2026-10-06 (P3-6 (a)); the
 * P3.0b bake-off kept 2 fps at 540 px. A caller passes them explicitly; the
 * proxy's own default stays the 360 px review rendition.
 */
export const DETECTION_PROXY = { fps: 2, height: 540 } as const

/**
 * Speaker Frames samples the spans an EDL keeps plus this much on each side —
 * decided 2026-10-06 (P3-5 (c)). The CALLER pads (`padSpans`): the proxy takes
 * the spans it is given, because the 15 fps attribution bursts (P3-4 rung 3)
 * reuse it with no margin.
 */
export const DETECTION_SPAN_MARGIN_MS = 2000

/** Spans the proxy cannot sample: empty, non-finite, reversed or zero-length. */
export class InvalidProxySpansError extends DeterministicJobError {
  constructor(message: string) {
    super(`media proxy: ${message}`)
    this.name = "InvalidProxySpansError"
  }
}

/** Widen each span by `marginMs` on both sides, never before the source's zero. */
export function padSpans(spans: readonly ProxySpan[], marginMs: number): ProxySpan[] {
  return spans.map((s) => ({ startMs: Math.max(0, s.startMs - marginMs), endMs: s.endMs + marginMs }))
}

/**
 * The canonical form of a span list — what the proxy encodes and what its cache
 * key hashes, so equivalent requests share one proxy. Whole milliseconds,
 * sorted, a start before zero clamped to zero, and spans that overlap, touch or
 * sit closer than one frame period at `fps` merged (two rows that close would
 * sample the same instant twice). The end is NOT clamped to the source's
 * length here — that needs the file; the encoder clips it.
 */
export function normalizeProxySpans(spans: readonly ProxySpan[], fps: number): ProxySpan[] {
  if (spans.length === 0) throw new InvalidProxySpansError("no spans to sample — omit `spans` to sample the whole source")
  const rounded = spans.map((s, i) => {
    if (!Number.isFinite(s?.startMs) || !Number.isFinite(s?.endMs)) {
      throw new InvalidProxySpansError(`span ${i} is not a finite range`)
    }
    const startMs = Math.max(0, Math.round(s.startMs))
    const endMs = Math.round(s.endMs)
    if (endMs <= startMs) throw new InvalidProxySpansError(`span ${i} ends at or before its start`)
    return { startMs, endMs }
  })
  rounded.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const periodMs = 1000 / fps
  const merged: ProxySpan[] = []
  for (const s of rounded) {
    const last = merged[merged.length - 1]
    if (last && s.startMs - last.endMs < periodMs) {
      merged[merged.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, s.endMs) }
    } else {
      merged.push(s)
    }
  }
  return merged
}

/** One encoded span: where it was cut from, and its frames' own times (ms). */
export interface EncodedProxySegment {
  /** The seek point on the source clock (ms). */
  readonly seekMs: number
  /** Presentation times of the frames the segment holds, from its own zero. */
  readonly framePtsMs: readonly number[]
}

/** The smallest value — a loop, not `Math.min(...xs)`: a 3-hour review proxy
 *  holds ~160k frames, past what a spread argument list may carry. */
function earliest(xs: readonly number[]): number {
  let min = Number.POSITIVE_INFINITY
  for (const x of xs) if (x < min) min = x
  return min
}

/**
 * Build the map from what was written: the segments, in join order, and the
 * joined proxy's frame times. The joined file must hold exactly the segments'
 * frames — a join that dropped one would shift every later row, so it throws.
 */
export function buildSpanMap(
  segments: readonly EncodedProxySegment[],
  proxyPtsMs: readonly number[],
  fps: number,
): ProxySpanMap {
  const pts = [...proxyPtsMs].sort((a, b) => a - b)
  const expected = segments.reduce((n, s) => n + s.framePtsMs.length, 0)
  if (pts.length !== expected) {
    throw new Error(`media proxy: the joined proxy holds ${pts.length} frames, its segments ${expected}`)
  }
  const periodMs = 1000 / fps
  const rows: ProxySpanMapRow[] = []
  let firstFrame = 0
  for (const seg of segments) {
    const frameCount = seg.framePtsMs.length
    if (frameCount === 0) continue
    const next = firstFrame + frameCount
    rows.push({
      proxyStartMs: pts[firstFrame],
      // A row ends exactly where the next one starts — the next frame's own
      // time, not "last + period", which at 29.97 fps lands one float ulp past
      // it and hands the join's frame to the wrong row.
      proxyEndMs: next < pts.length ? pts[next] : pts[next - 1] + periodMs,
      sourceStartMs: seg.seekMs + earliest(seg.framePtsMs),
      firstFrame,
      frameCount,
    })
    firstFrame = next
  }
  return rows
}

/** Source time (ms) of proxy frame `frame`, or undefined when no row holds it. */
export function proxyFrameToSourceMs(map: ProxySpanMap, fps: number, frame: number): number | undefined {
  if (!Number.isInteger(frame)) return undefined
  const row = map.find((r) => frame >= r.firstFrame && frame < r.firstFrame + r.frameCount)
  return row ? row.sourceStartMs + ((frame - row.firstFrame) * 1000) / fps : undefined
}

/** Source time (ms) of proxy time `proxyMs`; rows are half-open, so a join's
 *  instant belongs to the row it opens. Undefined outside every row. */
export function proxyMsToSourceMs(map: ProxySpanMap, proxyMs: number): number | undefined {
  // The LAST row starting at or before it: even a stored map whose bounds
  // overlap by a float hair still gives a join's instant to the row it opens.
  let row: ProxySpanMapRow | undefined
  for (const r of map) if (proxyMs >= r.proxyStartMs) row = r
  return row && proxyMs < row.proxyEndMs ? row.sourceStartMs + (proxyMs - row.proxyStartMs) : undefined
}

/** Float slack for a time that is exactly a frame's own (k × 1000 / fps, then
 *  × fps / 1000 can land a hair under k). Far below any real frame period. */
const FRAME_EPSILON = 1e-6

/** The proxy frame sampling source time `sourceMs` (the last one at or before
 *  it within a row), or undefined when no span sampled that time. */
export function sourceMsToProxyFrame(map: ProxySpanMap, fps: number, sourceMs: number): number | undefined {
  for (const r of map) {
    const k = Math.floor(((sourceMs - r.sourceStartMs) * fps) / 1000 + FRAME_EPSILON)
    if (k >= 0 && k < r.frameCount) return r.firstFrame + k
  }
  return undefined
}
