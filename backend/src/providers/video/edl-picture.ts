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
  /** The slot stream's read window on its SOURCE's own clock, in whole ms
   *  (`masterMs − offsetMs`, D19) — the clock face tracks are kept on.
   *  `startMs` is the stream's t = 0: the segment's start, or for a split
   *  tail its whole segment's start (`ctx.leadSec` earlier). `endMs` is the
   *  segment's own end (the stream runs a few frames past it). Where kept
   *  output frame k samples it: `pictureFrameSourceMs`. */
  readonly sourceSpan: { readonly startMs: number; readonly endMs: number }
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
  /** The output frame grid on the slot streams: kept output frame k
   *  (0 ≤ k < `frames`) is the canvas-rate frame at stream time
   *  `(leadFrames + k) / fps` — the conform keeps frames
   *  [leadFrames, leadFrames + frames) of the builder's output at the canvas
   *  rate. Non-zero only on a split tail: the frames its head, in the previous
   *  chunk, already rendered. A builder that moves its picture over time (a
   *  glide following a face track) samples its path on exactly these frames
   *  (`pictureFrameSourceMs`). */
  readonly leadFrames: number
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
 *
 * Either may carry a `memoryHint` (decided 2026-10-07): what the fragment
 * draws that costs memory beyond its canvas — `zoom: true` for a zoom (the
 * tween, or a segment drawn from a zoom's window), which adds the zoom's
 * term to the slice's reservation (`zoomPeakMemoryMiB`, once per slice). It
 * names the effect, not a figure: the host sizes it from the launch's own
 * thread counts. Optional — a fragment without one reserves exactly what it
 * always has. A malformed hint (not an object, or a non-boolean `zoom`) is
 * refused; unknown keys are ignored for forward compatibility, so a misspelled
 * key reads as no hint. Not part of the graph, so not part of the checkpoint
 * key.
 */
export type EdlPictureFragment = ({ readonly chain: string } | { readonly graph: string }) & {
  readonly memoryHint?: EdlPictureMemoryHint
}

/** What a picture fragment draws that costs memory beyond its canvas. */
export interface EdlPictureMemoryHint {
  /** The segment draws a zoom (Speaker View): its slice reserves the zoom's term. */
  readonly zoom?: boolean
}

/** Called once per segment of every picture slice, synchronously, while the
 *  slice's command is built (before anything runs), so the fragment is part of
 *  the command the checkpoint key hashes. Must be pure: the same context must
 *  give the same fragment, or a retry would never resume its checkpoints. And
 *  the fragment MUST be self-contained: everything it draws is written in it
 *  (a `sendcmd` carries its commands inline, `c=`), never read from a file the
 *  key would see only the path of. `pictureFragmentError` refuses the readers a
 *  moving crop would reach for (`movie` / `amovie`, a `sendcmd` / `asendcmd`
 *  command file) — a named list, not every file-reading filter. So a changed
 *  face track, track assignment or `motion` changes the fragment of exactly
 *  the segments it moves, and with it the key of exactly their chunks. */
export type EdlPictureBuilder = (ctx: EdlPictureContext) => EdlPictureFragment

/** Where kept output frame `k` of a segment samples slot `slot`'s source, in
 *  ms on that source's own clock (`EdlPictureSlot.sourceSpan`): the stream's
 *  t = 0 is `sourceSpan.startMs`, and frame k is at t = (leadFrames + k) / fps.
 *  Exact on the grid; the picture shown there is the source frame the canvas
 *  conform picks, so within one source frame of it (the read rebases t = 0 on
 *  the first frame it keeps). A follow path sampled here moves on exactly the
 *  frames the render keeps. Pure. */
export function pictureFrameSourceMs(ctx: Pick<EdlPictureContext, "slots" | "leadFrames" | "fps">, slot: number, k: number): number {
  const s = ctx.slots[slot]
  if (!s) throw new RangeError(`no slot ${slot} in this segment (it has ${ctx.slots.length})`)
  return s.sourceSpan.startMs + ((ctx.leadFrames + k) * 1000) / ctx.fps
}

/** The file a fragment reads, if any: a `movie` / `amovie` source, or a
 *  `sendcmd` / `asendcmd` command file (`f=` / `filename=`). The checkpoint
 *  key would hash the path, not what the file holds; `sendcmd` takes its
 *  commands inline (`c=` / `commands=`) instead. Quotes are honoured, so an
 *  inline command never reads as an option. */
function fileReadOf(text: string): string | undefined {
  for (const raw of splitUnquoted(text, ",;[]")) {
    const f = raw.trim()
    const eq = f.indexOf("=")
    // `name@instance` is the same filter under an instance name
    const name = (eq < 0 ? f : f.slice(0, eq)).trim().split("@")[0]!.trim()
    if (name === "movie" || name === "amovie") return `a ${name} source`
    if ((name === "sendcmd" || name === "asendcmd") && eq >= 0) {
      const opts = splitUnquoted(f.slice(eq + 1), ":")
      if (opts.some((opt) => /^\s*(?:f|filename)\s*=/.test(opt))) return `a ${name} command file — pass the commands inline, c=`
    }
  }
  return undefined
}

/** `text` split on any of `seps` outside ffmpeg's quoting (`'…'`, and a `\`
 *  escaping the next character). */
function splitUnquoted(text: string, seps: string): string[] {
  const parts: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === "\\" && i + 1 < text.length) {
      cur += ch + text[++i]
      continue
    }
    if (ch === "'") quoted = !quoted
    if (!quoted && seps.includes(ch)) {
      parts.push(cur)
      cur = ""
    } else cur += ch
  }
  parts.push(cur)
  return parts
}

/** A malformed `memoryHint`, named: one that is not an object, or whose
 *  `zoom` is not a boolean, is refused. Unknown keys are ignored for forward
 *  compatibility (a newer plugin may send a hint this host does not know), so
 *  a misspelled key (`zooms`, `Zoom`) reads as no hint and reserves no zoom
 *  term — the fragment's type is what catches that, not this check. */
function memoryHintError(hint: unknown): string | undefined {
  if (hint === undefined) return undefined
  if (!hint || typeof hint !== "object" || Array.isArray(hint)) return "a fragment's memoryHint is an object, e.g. { zoom: true }"
  const zoom = (hint as { zoom?: unknown }).zoom
  if (zoom !== undefined && typeof zoom !== "boolean") return "a fragment's memoryHint.zoom is true or false"
  return undefined
}

/** A fragment the timeline can place, or an Error naming what is wrong. Kept
 *  shallow on purpose: ffmpeg rejects a malformed graph with its own message;
 *  this only stops a fragment from breaking the graph AROUND it, or from
 *  reading a movie or command file the checkpoint key cannot see. */
export function pictureFragmentError(fragment: unknown, ctx: EdlPictureContext): string | undefined {
  if (!fragment || typeof fragment !== "object") return "the picture builder returned no fragment"
  const f = fragment as { chain?: unknown; graph?: unknown; memoryHint?: unknown }
  const hint = memoryHintError(f.memoryHint)
  if (hint) return hint
  const read = fileReadOf(typeof f.chain === "string" ? f.chain : typeof f.graph === "string" ? f.graph : "")
  if (read) return `the fragment reads a file (${read}): a picture is written whole into its fragment, which the checkpoint key hashes`
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
