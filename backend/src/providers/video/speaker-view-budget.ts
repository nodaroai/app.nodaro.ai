/**
 * Speaker View's job budget — a PURE leaf, like `apply-edl-budget.ts` (whose
 * timeline formula it runs): the video worker's dispatch site reads it through
 * `declaredJobBudgetMs("speaker-view", job.data)` (`lib/job-budget.ts`), and so
 * will the orchestrator's node ceilings and the relay's poll budget once the
 * node exists (C3.1).
 *
 * WHY THE APP HOLDS IT. Speaker View's handler lives in the private plugin and
 * a plugin handler cannot declare `livenessBudgetMs` (core-only). Without a
 * registered budget its pre-task heartbeat stopped at the 90-minute default,
 * and a 3-hour final was swept while still rendering (C2.0, decided
 * 2026-10-06).
 *
 * THE WORST CASE. The handler assigns layouts AFTER dispatch — after it splits
 * turns and reads Camera Switch's hints — so how many slots each segment
 * composites is not in the payload. The budget assumes the most the payload
 * allows: one slot per distinct speaker the edit names (its segments'
 * `speaker` and every layout slot's), at most `SPEAKER_VIEW_MAX_SLOTS`, and
 * that maximum when it names none. Every segment is charged that many slots
 * (`edlTimelineRenderBudgetMs`'s `assumeSlots`): each slot's decode, its
 * branch of the picture, the smaller graphs it forces (`videoSegmentCap`), and
 * the fetch of every picture source of the edit.
 *
 * THE TURN SPLIT (C2.4, decided 2026-10-07). The handler also splits every
 * segment that names no speaker at the transcript's turns, after dispatch, so
 * the edit it renders can have far more segments than the edit as given —
 * more chunks, more seeks, an audio pass. When the payload allows a split
 * (`turnSplitPossible`), the budget is an UPPER BOUND over every split the
 * turn rules allow (`turnSplitBoundMs`), proved term by term against
 * `edlTimelineRenderBudgetMs` from two facts of the rules alone: the cuts are
 * points of one shot timeline at least `SPEAKER_VIEW_MIN_SHOT_MS` apart, and
 * every piece keeps its segment's sources (only the first keeps its
 * transition). The plugin's split itself is not copied here: it is the
 * plugin's (SV1 b), and the private plugin cannot import this repo's code. Its
 * real output is the drift check (`__tests__/fixtures/speaker-view-turn-split.json`,
 * generated from the plugin; its README says how to regenerate it), which also
 * pins the 2.5 s minimum shot against the plugin's own export and its own cuts,
 * beside a seeded property test over random admissible splits. There is no
 * zoom TIME term (decided 2026-10-07): a zoom's measured cost is a memory
 * reservation for the slice predictor, not render time. The slots stay those of the edit AS GIVEN, which is how
 * the plugin picks who gets a tile (`speakerViewSlotSet`): the split names
 * pieces after the transcript's speakers, and must not narrow an unnamed
 * edit's six.
 *
 * THE PAYLOAD it reads: `{ edl, transcript?, quality? }` — the EDL the handler
 * will render (sources, segments on the master clock) and the transcript it
 * splits it with (an object or its JSON string). A jobs row whose transcript
 * was slimmed to `transcriptWordCount` reads as a transcript that may split.
 * A payload it cannot read declares no budget (`undefined`, the readers'
 * default); so does an edit over the 180-minute output cap (F4), which no
 * ingress lets through. Those gates are copied verbatim into the plugin's
 * `job-data-budget.test.ts`: change one only with that copy.
 */
import type { Edl, EdlSegment } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import {
  APPLY_EDL_CANVAS_PROBE_MS,
  APPLY_EDL_MAX_OUTPUT_MS,
  APPLY_EDL_PER_SOURCE_PREP_MS,
  AUDIO_FILTERGRAPH_MAX_SEGMENTS,
  CHUNK_RENDER_MARGIN,
  CHUNK_RENDER_SECS_PER_AUDIO_OUTPUT_SEC,
  CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC,
  CHUNK_RENDER_SECS_PER_OUTPUT_SEC,
  CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC,
  CHUNK_RENDER_TIMEOUT_FLOOR_MS,
  INPUT_SEEK_MARGIN_SEC,
  LIVENESS_CANVAS,
  WIDE_SLICE_FLOOR_MS,
  WIDE_SLICE_SECS_PER_OUTPUT_SEC,
  audioMuxTimeoutMs,
  audioSourceId,
  canvasPixelFactor,
  edlTimelineRenderBudgetMs,
  layoutSwitchOverlaps,
  pictureSlotFactor,
  pictureSourceIdsOf,
  referencedSourceIds,
  videoSegmentCap,
} from "./apply-edl-budget.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"

/** The most slots a Speaker View layout composites (`grid`, `SPEAKER_LAYOUTS`). */
export const SPEAKER_VIEW_MAX_SLOTS = 6

/** The shortest shot of Speaker View's turn split: Camera Switch's documented
 *  default, which the plugin's split reuses (D18). */
export const SPEAKER_VIEW_MIN_SHOT_MS = 2_500

/** The slots the budget assumes per segment: one per distinct speaker the
 *  edit names, capped at `SPEAKER_VIEW_MAX_SLOTS`; the cap when it names none. */
export function speakerViewWorstCaseSlots(edl: Edl): number {
  const speakers = new Set<string>()
  for (const seg of edl.segments as readonly (EdlSegment | null | undefined)[]) {
    if (!seg || typeof seg !== "object") continue
    if (typeof seg.speaker === "string" && seg.speaker) speakers.add(seg.speaker)
    const slots = Array.isArray(seg.layout?.slots) ? seg.layout!.slots! : []
    for (const slot of slots) if (slot && typeof slot.speaker === "string" && slot.speaker) speakers.add(slot.speaker)
  }
  return speakers.size === 0 ? SPEAKER_VIEW_MAX_SLOTS : Math.min(SPEAKER_VIEW_MAX_SLOTS, speakers.size)
}

/** The budget (ms) of ONE speaker-view job, read off its queue payload. */
export function speakerViewJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const { edl } = data as { edl?: Edl }
  if (!edl || typeof edl !== "object" || !Array.isArray(edl.segments) || !Array.isArray(edl.sources)) return undefined
  if (edl.segments.length === 0) return undefined
  if (edlDurationMs(edl) > APPLY_EDL_MAX_OUTPUT_MS) return undefined
  const slots = speakerViewWorstCaseSlots(edl)
  const given = edlTimelineRenderBudgetMs(edl, { output: "video", assumeSlots: slots })
  if (!turnSplitPossible(edl, data as Record<string, unknown>)) return given
  const bound = turnSplitBoundMs(edl, slots)
  return Number.isFinite(bound) ? Math.max(given, bound) : given
}

const named = (seg: EdlSegment): boolean => typeof seg.speaker === "string" && seg.speaker.length > 0

/** Can the handler's turn split change this edit? Not when every segment
 *  names a speaker, nor without a transcript that carries a speaker label
 *  (the plugin then returns the edit as it is). Errs toward "yes": a label on
 *  a word the plugin would drop, or a row that kept only the transcript's
 *  word count, reads as a split. */
function turnSplitPossible(edl: Edl, data: Record<string, unknown>): boolean {
  if ((edl.segments as readonly (EdlSegment | null | undefined)[]).every((seg) => !!seg && named(seg))) return false
  let transcript = data.transcript
  if (transcript === undefined || transcript === null || transcript === "") {
    return typeof data.transcriptWordCount === "number" && data.transcriptWordCount > 0
  }
  if (typeof transcript === "string") {
    try {
      transcript = JSON.parse(transcript)
    } catch {
      return false
    }
  }
  const words = transcript && typeof transcript === "object" ? (transcript as { words?: unknown }).words : undefined
  return Array.isArray(words) && words.some((w) => !!w && typeof w === "object" && typeof (w as { speaker?: unknown }).speaker === "string" && (w as { speaker: string }).speaker.length > 0)
}

/** The most pieces the turn split can cut one segment of `durMs` into: its
 *  cuts are points of the shot timeline strictly inside it, at least
 *  `SPEAKER_VIEW_MIN_SHOT_MS` apart, so at most ⌈durMs / min shot⌉ of them. */
function maxTurnPieces(durMs: number): number {
  return durMs > 0 ? 1 + Math.ceil(durMs / SPEAKER_VIEW_MIN_SHOT_MS) : 1
}

/** Does the boundary INTO `seg` ask for an overlap (a crossfade, or an
 *  `xfade:*` switch)? The split only keeps or shortens these. */
const overlapAsked = (seg: EdlSegment): boolean =>
  (seg.transition?.type === "crossfade" && (seg.transition.durationMs ?? 0) > 0) || layoutSwitchOverlaps(seg.layout)

/**
 * An upper bound (ms) on `edlTimelineRenderBudgetMs(split, { output: "video",
 * assumeSlots: slots })` for EVERY turn split of `edl`. Term by term:
 *
 *  - PREP is the edit's own: the pieces read the sources their segments read.
 *  - PLAN SIZE. The split has at most P = Σ `maxTurnPieces` segments (named
 *    ones are never cut), and its overlap boundaries are the edit's own (X of
 *    them: only a first piece keeps its transition). The planner closes a
 *    chunk either full (≥ cap segments), or inside a crossfade run (once per
 *    overlap boundary at most, adding at most one split half); so a plan has
 *    at most ⌊(P + X) / cap⌋ + X + 1 chunks, for the picture and sound caps.
 *  - EACH CHUNK's kill budget is max(floor, ⌈margin · work⌉ s) ≤ floor + 1 s
 *    + margin · work. A chunk wider than its cap adds at most the wide floor
 *    and 6 s per output second: it holds more than cap segments, each after
 *    the first joined by an overlap, and those overlaps are consecutive
 *    overlap boundaries of the edit (a cut piece ends a run). So a run of r
 *    such boundaries in the edit holds at most ⌊r / cap⌋ wide chunks, and
 *    only a run of at least cap can hold one.
 *  - WORK sums over chunks to at most: the output — every segment's length;
 *    the decode of a source — its reads plus, in edit order, the jumps between
 *    consecutive segments reading it (the hull of a chunk's reads is at most
 *    the path through them, and a segment's pieces are contiguous), plus one
 *    seek margin per source per chunk and one segment's length per planner
 *    split (its tail re-reads its head).
 *  - ASSEMBLY (every video render past one chunk) is charged always.
 */
function turnSplitBoundMs(edl: Edl, slots: number): number {
  const secs = (ms: number) => ms / 1000
  const segs = edl.segments
  const masterAudioId = edl.sources.find((s) => s.role === "master-audio")?.id
  let pieces = 0
  let overlaps = 0
  let outMs = 0
  let maxSegMs = 0
  // Per source: the length it is read for and the jumps between consecutive
  // segments reading it, in edit order (source time; the offset cancels).
  const reads = { video: new Map<string, { ms: number; lastOutMs?: number }>(), audio: new Map<string, { ms: number; lastOutMs?: number }>() }
  const note = (kind: "video" | "audio", id: string | undefined, seg: EdlSegment) => {
    if (!id) return
    const r = reads[kind].get(id) ?? { ms: 0 }
    const jump = r.lastOutMs === undefined ? 0 : Math.abs(seg.inMs - r.lastOutMs)
    reads[kind].set(id, { ms: r.ms + Math.max(0, seg.outMs - seg.inMs) + jump, lastOutMs: seg.outMs })
  }
  segs.forEach((seg, i) => {
    const durMs = Math.max(0, seg.outMs - seg.inMs)
    outMs += durMs
    maxSegMs = Math.max(maxSegMs, durMs)
    pieces += named(seg) ? 1 : maxTurnPieces(durMs)
    if (i > 0 && overlapAsked(seg)) overlaps++
    for (const id of pictureSourceIdsOf(edl, seg)) note("video", id, seg)
    note("audio", audioSourceId(edl, seg, masterAudioId), seg)
  })
  // Runs of consecutive overlap boundaries: [first boundary index, length].
  const runs: Array<[number, number]> = []
  segs.forEach((seg, i) => {
    if (i === 0 || !overlapAsked(seg)) return
    const last = runs[runs.length - 1]
    if (last && last[0] + last[1] === i) last[1]++
    else runs.push([i, 1])
  })
  const durOf = (i: number) => Math.max(0, segs[i]!.outMs - segs[i]!.inMs)
  /** The wide chunks a plan of this cap can make, and the most they output. */
  const wideMs = (cap: number): number => {
    let ms = 0
    for (const [first, r] of runs) {
      const wide = Math.floor(r / cap)
      if (wide === 0) continue
      let runMs = 0
      for (let i = first - 1; i < first + r; i++) runMs += durOf(i)
      ms += wide * (WIDE_SLICE_FLOOR_MS + 1000) + WIDE_SLICE_SECS_PER_OUTPUT_SEC * runMs
    }
    return ms
  }
  const sum = (m: Map<string, { ms: number }>) => [...m.values()].reduce((acc, r) => acc + r.ms, 0)

  const k = Math.max(1, Math.floor(slots))
  const pf = Math.max(1, canvasPixelFactor(LIVENESS_CANVAS))
  const planned = pieces + overlaps
  const videoChunks = Math.floor(planned / videoSegmentCap(k)) + overlaps + 1
  const audioChunks = Math.floor(planned / AUDIO_FILTERGRAPH_MAX_SEGMENTS) + overlaps + 1
  const videoSpanSec = secs(sum(reads.video))
    + INPUT_SEEK_MARGIN_SEC * reads.video.size * videoChunks
    + secs(maxSegMs) * reads.video.size * overlaps
  const audioSpanSec = secs(sum(reads.audio)) + INPUT_SEEK_MARGIN_SEC * reads.audio.size * Math.max(videoChunks, audioChunks)
  const outSec = secs(outMs)
  const perChunkMs = CHUNK_RENDER_TIMEOUT_FLOOR_MS + 1000

  const picture = videoChunks * perChunkMs + wideMs(videoSegmentCap(k)) + CHUNK_RENDER_MARGIN * 1000 * (
    CHUNK_RENDER_SECS_PER_OUTPUT_SEC * pf * pictureSlotFactor(k) * outSec
    + CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC * pf * k * videoSpanSec
    + CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC * audioSpanSec
  )
  const sound = audioChunks * perChunkMs + wideMs(AUDIO_FILTERGRAPH_MAX_SEGMENTS) + CHUNK_RENDER_MARGIN * 1000 * (
    CHUNK_RENDER_SECS_PER_AUDIO_OUTPUT_SEC * outSec
    + CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC * audioSpanSec
  )
  const assemble = 2 * DEFAULT_FFMPEG_TIMEOUT_MS + sound + audioMuxTimeoutMs(outSec)

  const fetched = referencedSourceIds(edl, "video")
  for (const s of edl.sources) if (s.kind === "video") fetched.add(s.id)
  const prep = fetched.size * APPLY_EDL_PER_SOURCE_PREP_MS + APPLY_EDL_CANVAS_PROBE_MS

  return Math.ceil(prep + picture + assemble)
}
