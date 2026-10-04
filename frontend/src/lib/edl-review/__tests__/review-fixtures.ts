/**
 * Seeded random plans, transcripts and review operations for the property
 * tests. fast-check is not a dependency of this repo, so the sequences come
 * from mulberry32: every failure names its seed and replays exactly.
 *
 * The plans have the shape Edit Plan's tighten mode emits: segments in master
 * order, never overlapping, sometimes abutting (a camera split); every other
 * stretch dropped with a reason, where two reasons may overlap (a filler inside
 * a tangent is two rows) or abut. Some plans add what the planner never writes
 * but the contract allows (crossfades, layout switches, an uncovered gap, no
 * `dropped` at all), so the model is checked against the contract, not one
 * producer.
 */
import {
  normalizeEdl,
  normalizeTranscript,
  validateEdl,
  type Edl,
  type Transcript,
} from "@nodaro/shared"
import type { Interval } from "../intervals"
import { cutRange, restoreReason, restoreSpan, type KeptSet } from "../kept-set"

export interface Rng {
  readonly next: () => number
  /** An integer in [lo, hi]. */
  readonly int: (lo: number, hi: number) => number
  readonly chance: (p: number) => boolean
  readonly pick: <T>(xs: readonly T[]) => T
}

/** mulberry32: deterministic for a seed. */
export function rngOf(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  }
}

/** The reasons Edit Plan writes. */
export const PLAN_REASONS = ["silence", "filler", "false-start", "tangent", "no-picture"] as const

const CAMS = ["cam-a", "cam-b"] as const
const otherCam = (cam: string): string => (cam === "cam-a" ? "cam-b" : "cam-a")

type RawSegment = { id: string; inMs: number; outMs: number; [k: string]: unknown }
type RawDropped = { inMs: number; outMs: number; reason: string }

function keptBlock(rng: Rng, at: number, segments: RawSegment[], ctx: { cam: string; mic: boolean }): number {
  const pieces = rng.int(1, 3)
  let t = at
  for (let p = 0; p < pieces; p++) {
    const len = rng.int(250, 4000)
    if (rng.chance(0.35)) ctx.cam = otherCam(ctx.cam)
    segments.push({
      id: `seg-${segments.length}`,
      inMs: t,
      outMs: t + len,
      video: ctx.cam,
      ...(ctx.mic ? { audio: "mic" } : {}),
      ...(rng.chance(0.1) ? { labels: ["hook"] } : {}),
    })
    t += len
  }
  return t
}

function removedBlock(rng: Rng, at: number, dropped: RawDropped[]): number {
  const len = rng.int(150, 3500)
  const end = at + len
  const r1 = rng.pick(PLAN_REASONS)
  const r2 = rng.pick(PLAN_REASONS.filter((r) => r !== r1))
  const shape = rng.next()
  if (shape < 0.08) return end // an uncovered gap: neither kept nor dropped
  if (shape < 0.3 && len > 120) {
    const mid = at + rng.int(50, len - 50)
    dropped.push({ inMs: at, outMs: mid, reason: r1 }, { inMs: mid, outMs: end, reason: r2 })
  } else if (shape < 0.5 && len > 120) {
    const a = rng.int(0, Math.floor(len / 3))
    const b = rng.int(0, Math.floor(len / 3))
    dropped.push({ inMs: at, outMs: end, reason: r1 }, { inMs: at + a, outMs: end - b, reason: r2 })
  } else {
    dropped.push({ inMs: at, outMs: end, reason: r1 })
  }
  return end
}

/** Transitions into segments 1.., within ffmpeg's bound so the plan stays valid. */
function addTransitions(rng: Rng, segments: RawSegment[]): void {
  for (let i = 1; i < segments.length; i++) {
    const dur = (s: RawSegment) => s.outMs - s.inMs
    const bound = Math.floor(0.9 * Math.min(dur(segments[i]), dur(segments[i - 1])))
    const roll = rng.next()
    if (roll < 0.12 && bound >= 1) {
      segments[i] = { ...segments[i], transition: { type: "crossfade", durationMs: rng.int(1, bound) } }
    } else if (roll < 0.2) {
      segments[i] = { ...segments[i], transition: { type: "cut" } }
    } else if (roll < 0.26 && bound >= 1) {
      segments[i] = { ...segments[i], layout: { mode: "single", transition: { type: "xfade:fade", durationMs: rng.int(1, bound) } } }
    } else if (roll < 0.3) {
      segments[i] = { ...segments[i], layout: { mode: "single" } }
    }
  }
}

/** A valid, reviewable plan. Throws if the generator ever makes an invalid one,
 *  so a generator bug never reads as a model bug. */
export function randomBase(rng: Rng): Edl {
  const mic = rng.chance(0.6)
  const sources = [
    { id: "cam-a", url: "https://cdn.test/cam-a.mp4", kind: "video", role: "camera" },
    { id: "cam-b", url: "https://cdn.test/cam-b.mp4", kind: "video", role: "camera", offsetMs: rng.pick([0, 0, 700, -400]) },
    ...(mic ? [{ id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" }] : []),
  ]
  const blocks = rng.int(1, 9)
  const kinds = Array.from({ length: blocks }, () => (rng.chance(0.55) ? "kept" : "removed"))
  if (!kinds.includes("kept")) kinds[rng.int(0, blocks - 1)] = "kept"
  const segments: RawSegment[] = []
  const dropped: RawDropped[] = []
  const ctx = { cam: rng.pick(CAMS) as string, mic }
  let t = rng.chance(0.3) ? rng.int(1, 1500) : 0
  for (const kind of kinds) t = kind === "kept" ? keptBlock(rng, t, segments, ctx) : removedBlock(rng, t, dropped)
  addTransitions(rng, segments)
  const withDropped = !rng.chance(0.08)
  const raw = {
    version: 1,
    clock: "master",
    sources,
    segments,
    ...(withDropped ? { dropped } : {}),
    ...(rng.chance(0.2) ? { meta: { title: "Episode 12" } } : {}),
  }
  const base = normalizeEdl(raw)
  const v = validateEdl(base)
  if (!v.ok) throw new Error(`the generator made an invalid plan: ${v.issues.join("; ")}`)
  return base
}

/** The latest time the plan covers. */
export function planEndMs(base: Edl): number {
  const ends = [...base.segments.map((s) => s.outMs), ...(base.dropped ?? []).map((d) => d.outMs)]
  return Math.max(0, ...ends)
}

/** A transcript over the plan's time, with unique word texts (`w<i>`, some
 *  ending a sentence) so a remapped word can be traced back to its index.
 *  Some words have no length, some overlap (crosstalk), some straddle a cut. */
export function randomTranscript(rng: Rng, base: Edl): Transcript {
  const sourceId = rng.chance(0.3) ? "cam-b" : undefined
  const off = sourceId ? (base.sources.find((s) => s.id === sourceId)?.offsetMs ?? 0) : 0
  const endMs = planEndMs(base) + 800
  const speakers = rng.chance(0.6)
  let speaker = "A"
  const words: Array<Record<string, unknown>> = []
  let t = rng.int(0, 600)
  while (t < endMs && words.length < 300) {
    const len = rng.chance(0.04) ? 0 : rng.int(60, 700)
    if (speakers && rng.chance(0.12)) speaker = speaker === "A" ? "B" : "A"
    words.push({
      text: `w${words.length}${rng.chance(0.12) ? "." : ""}`,
      startMs: t - off,
      endMs: t + len - off,
      ...(speakers ? { speaker } : {}),
    })
    t = rng.chance(0.05)
      ? t + Math.max(0, len - rng.int(20, 200))
      : t + len + (rng.chance(0.1) ? rng.int(1200, 3500) : rng.int(0, 300))
  }
  return normalizeTranscript({ version: 1, ...(sourceId ? { sourceId } : {}), words })
}

export type Op =
  | { readonly kind: "restoreSpan"; readonly span: Interval }
  | { readonly kind: "restoreReason"; readonly reason: string }
  | { readonly kind: "cutRange"; readonly range: Interval }

/** One review action, drawn the way the inspector offers them: restore a span
 *  of the plan or of the current edit, restore a whole reason (an unknown one
 *  included), cut a word selection, or cut an arbitrary range (mid-word, in a
 *  gap, empty). */
export function randomOp(rng: Rng, base: Edl, edited: Edl, transcript: Transcript, offsetMs: number): Op {
  const roll = rng.next()
  const spans = [...(base.dropped ?? []), ...(edited.dropped ?? [])]
  if (roll < 0.35 && spans.length > 0) return { kind: "restoreSpan", span: rng.pick(spans) }
  if (roll < 0.5) return { kind: "restoreReason", reason: rng.pick([...PLAN_REASONS, "manual", "breath"]) }
  const words = transcript.words
  if (words.length > 0 && rng.chance(0.6)) {
    const i = rng.int(0, words.length - 1)
    const j = Math.min(words.length - 1, i + rng.int(0, 6))
    return { kind: "cutRange", range: { inMs: words[i].startMs + offsetMs, outMs: words[j].endMs + offsetMs } }
  }
  const a = rng.int(-500, planEndMs(base) + 500)
  return { kind: "cutRange", range: { inMs: a, outMs: a + rng.int(0, 3000) } }
}

export function applyOp(kept: KeptSet, op: Op, base: Edl, transcript: Transcript, offsetMs: number): KeptSet {
  switch (op.kind) {
    case "restoreSpan":
      return restoreSpan(kept, op.span)
    case "restoreReason":
      return restoreReason(kept, base, op.reason)
    case "cutRange":
      return cutRange(kept, op.range, transcript.words, offsetMs)
  }
}
