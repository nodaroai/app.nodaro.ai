/**
 * The picture seam of the EDL timeline (`edl-timeline.ts`, Speaker View SV1 b,
 * decided 2026-10-06). The timeline owns WHEN every frame is: the cumulative
 * frame grid, chunking, input seeks, the one sound pass, checkpoints, budgets
 * and memory reservations. A picture builder owns only WHAT a segment's frame
 * looks like: it receives each slot's source, already read on the grid, and
 * returns the filter-graph fragment that draws them onto the canvas.
 *
 * Apply EDL's builder is the full-frame one (`edl-picture-fullframe.ts`).
 * Speaker View's builders live in the private plugin and reach the timeline
 * through `tk.ffmpeg.renderEdlTimeline` (`lib/private-plugins/types.ts`).
 *
 * Pure types and one validator — no ffmpeg runtime.
 */
import type { EdlRegion, EdlSegment } from "@nodaro/shared"

/** One slot of a segment's picture, as the builder receives it. */
export interface EdlPictureSlot {
  /** `EdlSource.id`. */
  readonly source: string
  /** The crop on that source, as fractions of its frame (D20, `resolveEdlSegmentSlots`). */
  readonly region: EdlRegion
  /** Which D20 rung supplied `region` ("full" = no crop was set anywhere). */
  readonly regionFrom: "slot" | "segment" | "resolver" | "speaker" | "source" | "full"
  readonly speaker?: string
  /** 0..1, the active slot = 1 (D20). */
  readonly weight?: number
  /** The graph label of this slot's stream, e.g. `[p3s0]`, for a `graph`
   *  fragment — one slot included (a 9:16 `single` that fills its background
   *  needs a graph). A `chain` reads its one slot inline and ignores it. The stream is
   *  the source held past its end (frozen last frame) and trimmed to the
   *  segment's read window: its first frame is `ctx.leadSec` before the
   *  segment's own start and its timestamps start at 0 there; it runs a few
   *  frames past the segment's end. The timeline then conforms the
   *  builder's output to the canvas rate and keeps exactly `ctx.frames`. */
  readonly label?: string
}

/** What a picture builder knows about ONE segment of ONE slice. */
export interface EdlPictureContext {
  /** The segment as planned: a split half of a long crossfade run carries
   *  `splitLeadMs` / `splitTailMs` (`PlanSegment`). Its `layout` is the
   *  EDL's own (mode, slots, emphasis, transition). */
  readonly segment: EdlSegment
  /** The segment's position in its slice (0-based). */
  readonly index: number
  /** The resolved slots, in `layout.slots` order (one implicit slot of
   *  `segment.video` when the segment has no layout slots). */
  readonly slots: readonly EdlPictureSlot[]
  /** The output canvas, in even pixels. */
  readonly canvas: { readonly width: number; readonly height: number }
  /** The canvas rate (frames per second, 0.001-keyed). */
  readonly fps: number
  readonly quality: "proxy" | "final"
  /** The segment's window on the master clock, in seconds (outMs − inMs). */
  readonly durationSec: number
  /** Seconds the slot streams start before the segment's own start: 0, or a
   *  split tail's `splitLeadMs` (its picture keeps the whole segment's phase,
   *  so a tween over the whole segment stays continuous across the split). */
  readonly leadSec: number
  /** Frames the segment holds on the cumulative output grid. */
  readonly frames: number
  /** Its first frame's index on the GLOBAL output grid (`frameAtMs`). */
  readonly startFrame: number
  /** The label a `graph` fragment must write — one canvas-sized stream. */
  readonly output: string
  /** Prefix for any intermediate label a `graph` fragment defines
   *  (`[${scope}…]`), unique per segment within the slice. */
  readonly scope: string
}

/**
 * A segment's picture:
 *  - `chain` — a linear filter chain (no labels) applied to the ONE slot's
 *    stream; valid only for a one-slot segment. The full-frame builder's
 *    scale + pad is one. The timeline inlines it into the slot's read.
 *  - `graph` — filter-graph statements (`;`-joined) that read every slot's
 *    `label` and write `ctx.output`. Intermediate labels start with
 *    `[${ctx.scope}`.
 */
export type EdlPictureFragment = { readonly chain: string } | { readonly graph: string }

/** Called once per segment of every picture slice, synchronously, while the
 *  slice's command is built (before anything runs), so the fragment is part of
 *  the command the checkpoint key hashes. Must be pure: the same context must
 *  give the same fragment, or a retry would never resume its checkpoints. */
export type EdlPictureBuilder = (ctx: EdlPictureContext) => EdlPictureFragment

/** A fragment the timeline can place, or an Error naming what is wrong. Kept
 *  shallow on purpose: ffmpeg rejects a malformed graph with its own message;
 *  this only stops a fragment from breaking the graph AROUND it. */
export function pictureFragmentError(fragment: unknown, ctx: EdlPictureContext): string | undefined {
  if (!fragment || typeof fragment !== "object") return "the picture builder returned no fragment"
  const f = fragment as { chain?: unknown; graph?: unknown }
  if (typeof f.chain === "string") {
    if (typeof f.graph === "string") return "a picture fragment is a chain OR a graph, not both"
    if (ctx.slots.length !== 1) return `a chain draws one slot; segment "${ctx.segment.id}" has ${ctx.slots.length}`
    if (!f.chain.trim() || /[[\];]/.test(f.chain)) return "a chain is a non-empty linear filter chain (no labels, no ';')"
    return undefined
  }
  if (typeof f.graph === "string") {
    if (!f.graph.includes(ctx.output)) return `a graph fragment must write ${ctx.output}`
    return undefined
  }
  return "a picture fragment is { chain } or { graph }"
}
