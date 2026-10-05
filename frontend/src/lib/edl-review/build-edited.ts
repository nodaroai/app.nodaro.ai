/**
 * buildEdited(plan, K): the EDL a review produces — the plan, with K as its
 * kept time.
 *
 * SEGMENTS. Each maximal interval of K, split where the plan had two segments
 * ABUTTING (a boundary it made on purpose, such as a camera split) and where
 * the look changes (camera, sound, speaker, framing, labels: everything but
 * the id, the time and the transition in). A piece carries the look of the plan
 * segment it lies in; restored time between two segments carries the look of
 * the one before it (before the first segment, of the first). So restoring the
 * cut between two pieces of one look joins them into one segment again: new
 * joins are coalesced, and the plan's own boundaries are kept.
 *
 * IDS AND TRANSITIONS follow a segment's start. The piece that starts where a
 * plan segment starts keeps that segment's id and its transition into it; any
 * other piece gets a new id, `<plan id>@<inMs>`, and no transition. A
 * transition is also dropped from the first segment (it has no predecessor),
 * and where restored time turned a cut into a continuous join, since a blend
 * there would overlap material that now plays straight through. When a cut
 * shortens a neighbour, an overlap transition (crossfade, `xfade:*`) is
 * shortened to ffmpeg's bound, 0.9 × the shorter neighbour, as the render
 * does with its default crossfade; one with nothing left is dropped.
 *
 * DROPPED. Each plan span minus K, keeping its reason and its place in the
 * list; then the plan's kept time that K cuts, as "manual".
 *
 * The plan is passed as normalizeEdl returns it. With nothing edited the
 * result is the plan itself, and the result is normalized too, so a saved edit
 * reopens to the identical EDL (both checked by the property tests).
 *
 * Restored time takes the look of a neighbouring segment, so restoring a span
 * dropped as "no-picture" names a camera that did not film it: structurally
 * valid, but possibly not renderable (time before a late camera's first
 * segment reads before that camera starts). buildEdited builds any K; whether
 * a restore is allowed is the render rule's call, and restore.ts locks the
 * restores it refuses (decided 2026-10-05).
 */
import { normalizeEdl, speakerSwitchOverlaps, type Edl, type EdlDropped, type EdlLayout, type EdlSegment } from "@nodaro/shared"
import { spanMinus, subtractIntervals } from "./intervals"
import { keptSetOf, MANUAL_REASON, type KeptSet } from "./kept-set"

/**
 * Can K edit this plan? Its segments must run forward on the master clock
 * without overlapping (abutting is fine), and there must be at least one, to
 * give restored time a look. Edit Plan's tighten EDLs always are; anything else
 * opens read-only.
 */
export function isReviewableBase(edl: Edl): boolean {
  if (edl.clock !== "master" || edl.segments.length === 0) return false
  let prevOutMs = -Infinity
  for (const seg of edl.segments) {
    if (!(seg.outMs > seg.inMs) || seg.inMs < prevOutMs) return false
    prevOutMs = seg.outMs
  }
  return true
}

/** A piece of K, and the plan segment whose look it carries. */
interface Piece {
  readonly inMs: number
  readonly outMs: number
  readonly owner: number
}

/** A copy of `obj` without `drop`'s keys and without undefined values. */
function without<T extends object>(obj: T, drop: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) if (!drop.has(key) && value !== undefined) out[key] = value
  return out
}

const NOT_LOOK = new Set(["id", "inMs", "outMs", "transition", "layout"])
const LAYOUT_TRANSITION = new Set(["transition"])

/** Everything about a segment but its id, its time and its transition in. */
function lookOf(seg: EdlSegment): Record<string, unknown> {
  const look = without(seg, NOT_LOOK)
  return seg.layout ? { ...look, layout: without(seg.layout, LAYOUT_TRANSITION) } : look
}

/** JSON with every object's keys sorted, so equal looks compare equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/** K's intervals, split at the plan's abutting boundaries and changes of look. */
function piecesOf(segs: readonly EdlSegment[], kept: KeptSet): Piece[] {
  const looks = segs.map((seg) => canonicalJson(lookOf(seg)))
  const pieces: Piece[] = []
  let k = 0
  for (const run of kept) {
    while (k + 1 < segs.length && segs[k + 1].inMs <= run.inMs) k++
    let owner = k
    let start = run.inMs
    for (let next = k + 1; next < segs.length && segs[next].inMs < run.outMs; next++) {
      const at = segs[next].inMs
      if (segs[next - 1].outMs === at || looks[next - 1] !== looks[next]) {
        pieces.push({ inMs: start, outMs: at, owner })
        start = at
        owner = next
      }
    }
    pieces.push({ inMs: start, outMs: run.outMs, owner })
  }
  return pieces
}

type Transition = { readonly type: string; readonly durationMs?: number }

/** An overlap transition clamped to ffmpeg's bound; undefined once nothing is left. */
function clamped<T extends Transition>(t: T, overlaps: boolean, boundMs: number): T | undefined {
  if (!overlaps || (t.durationMs ?? 0) <= boundMs) return t
  return boundMs >= 1 ? { ...t, durationMs: boundMs } : undefined
}

function segmentOf(segs: readonly EdlSegment[], pieces: readonly Piece[], i: number, id: string): EdlSegment {
  const p = pieces[i]
  const seg = segs[p.owner]
  const prev = pieces[i - 1]
  const continuousNow = prev !== undefined && prev.outMs === p.inMs
  const continuousInPlan = p.owner > 0 && segs[p.owner - 1].outMs === seg.inMs
  const keepsTransition = p.inMs === seg.inMs && prev !== undefined && !(continuousNow && !continuousInPlan)
  const boundMs = prev ? Math.floor(0.9 * Math.min(p.outMs - p.inMs, prev.outMs - prev.inMs) + 1e-9) : 0
  const look = lookOf(seg)
  const transition =
    keepsTransition && seg.transition
      ? clamped(seg.transition, seg.transition.type === "crossfade" && (seg.transition.durationMs ?? 0) > 0, boundMs)
      : undefined
  const switchIn: Transition | undefined = keepsTransition ? seg.layout?.transition : undefined
  const layoutTransition = switchIn
    ? clamped(switchIn, speakerSwitchOverlaps(switchIn.type) && (switchIn.durationMs ?? 0) > 0, boundMs)
    : undefined
  return {
    id,
    inMs: p.inMs,
    outMs: p.outMs,
    ...look,
    ...(transition ? { transition } : {}),
    ...(look.layout && layoutTransition ? { layout: { ...(look.layout as EdlLayout), transition: layoutTransition } } : {}),
  } as EdlSegment
}

export function buildEdited(base: Edl, kept: KeptSet): Edl {
  if (!isReviewableBase(base)) {
    throw new Error("buildEdited: the plan is not reviewable (segments must run forward on the master clock without overlapping)")
  }
  const segs = base.segments
  const pieces = piecesOf(segs, kept)
  const planIds = new Set(segs.map((s) => s.id))
  const taken = new Set<string>()
  const freshId = (seed: string): string => {
    let id = seed
    for (let n = 2; planIds.has(id) || taken.has(id); n++) id = `${seed}~${n}`
    return id
  }
  const segments = pieces.map((p, i) => {
    const seg = segs[p.owner]
    const id = p.inMs === seg.inMs ? seg.id : freshId(`${seg.id}@${p.inMs}`)
    taken.add(id)
    return segmentOf(segs, pieces, i, id)
  })

  const dropped: EdlDropped[] = []
  for (const d of base.dropped ?? []) {
    for (const part of spanMinus(d, kept)) dropped.push({ inMs: part.inMs, outMs: part.outMs, reason: d.reason })
  }
  for (const cut of subtractIntervals(keptSetOf(base), kept)) {
    dropped.push({ inMs: cut.inMs, outMs: cut.outMs, reason: MANUAL_REASON })
  }
  const withDropped = base.dropped !== undefined || dropped.length > 0
  return normalizeEdl({ ...base, segments, ...(withDropped ? { dropped } : {}) })
}
