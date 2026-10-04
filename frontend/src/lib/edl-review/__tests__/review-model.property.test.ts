import { describe, it, expect } from "vitest"
import {
  edlDurationMs,
  normalizeEdl,
  remapTranscriptThroughEdl,
  speakerSwitchOverlaps,
  validateEdl,
  type Edl,
  type Transcript,
} from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { intersectIntervals, toIntervalSet, unionIntervals, type Interval, type IntervalSet } from "../intervals"
import { keptSetOf, restoredOf, type KeptSet } from "../kept-set"
import { buildWordIndex, transcriptOffsetMs, type WordIndex, type WordMark } from "../word-index"
import { applyOp, randomBase, randomOp, randomTranscript, rngOf, type Op, type Rng } from "./review-fixtures"

// Property tests over seeded random sequences (fast-check is not a dependency):
// random valid plans, random transcripts, random runs of the inspector's
// operations. A failure names its seed; rngOf(seed) replays it exactly.

const SEEDS = 160
const MAX_OPS = 14

interface Session {
  readonly base: Edl
  readonly transcript: Transcript
  readonly offsetMs: number
}

function sessionOf(rng: Rng): Session {
  const base = randomBase(rng)
  const transcript = randomTranscript(rng, base)
  return { base, transcript, offsetMs: transcriptOffsetMs(base, transcript) }
}

/** Every state a random run of operations passes through, with the op that led there. */
function* run(seed: number): Generator<{ s: Session; kept: KeptSet; op: Op; step: number }> {
  const rng = rngOf(seed)
  const s = sessionOf(rng)
  let kept = keptSetOf(s.base)
  const steps = rng.int(1, MAX_OPS)
  for (let step = 0; step < steps; step++) {
    const op = randomOp(rng, s.base, buildEdited(s.base, kept), s.transcript, s.offsetMs)
    kept = applyOp(kept, op, s.base, s.transcript, s.offsetMs)
    yield { s, kept, op, step }
  }
}

const cover = (edl: Edl): IntervalSet => toIntervalSet([...edl.segments, ...(edl.dropped ?? [])])
const persisted = (edl: Edl): Edl => normalizeEdl(JSON.parse(JSON.stringify(edl)))

/**
 * buildWordIndex by brute force, O(W·D), from its contract alone: each word
 * against all of the kept time and against every dropped span, in list order.
 * The only sorting is the time order of the gaps and of the words they sit before.
 */
function wordIndexOracle(edl: Edl, transcript: Transcript): WordIndex {
  const off = transcriptOffsetMs(edl, transcript)
  const words = transcript.words.map((w) => ({ s: w.startMs + off, e: w.endMs + off }))
  type Word = (typeof words)[number]
  const kept = toIntervalSet(edl.segments)
  const drops = edl.dropped ?? []
  // How much of the word a span covers, or undefined when it misses the word.
  // A word with no length is an instant, covered (by 0) when the span holds it.
  const coverOf = (w: Word, span: Interval): number | undefined => {
    if (w.e === w.s) return span.inMs <= w.s && w.s < span.outMs ? 0 : undefined
    const overlap = Math.min(w.e, span.outMs) - Math.max(w.s, span.inMs)
    return overlap > 0 ? overlap : undefined
  }
  const holds = (span: Interval, w: Word): boolean =>
    w.e === w.s ? span.inMs <= w.s && w.s < span.outMs : span.inMs <= w.s && w.e <= span.outMs

  const marks = words.map((w): WordMark => {
    const keptCovers = kept.map((k) => coverOf(w, k)).filter((c): c is number => c !== undefined)
    const keptMs = keptCovers.reduce((ms, c) => ms + c, 0)
    const state = keptCovers.length === 0 ? "cut" : w.e === w.s || keptMs === w.e - w.s ? "kept" : "partial"
    if (state === "kept") return { state }
    // The span covering most of the word; on a tie the longer span, then the lower index.
    let best = -1
    let bestCover = -1
    drops.forEach((d, di) => {
      const c = coverOf(w, d)
      if (c === undefined) return
      const longer = best >= 0 && d.outMs - d.inMs > drops[best].outMs - drops[best].inMs
      if (c > bestCover || (c === bestCover && longer)) {
        best = di
        bestCover = c
      }
    })
    return best < 0 ? { state } : { state, reason: drops[best].reason, drop: best }
  })

  const inTime = (n: number, key: (i: number) => number): number[] =>
    Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a) - key(b) || a - b)
  const wordsInTime = inTime(words.length, (i) => words[i].s)
  const gaps = inTime(drops.length, (i) => drops[i].inMs)
    .filter((di) => drops[di].outMs > drops[di].inMs && !words.some((w) => holds(drops[di], w)))
    .map((di) => ({ drop: di, beforeWord: wordsInTime.find((wi) => words[wi].s >= drops[di].inMs) ?? words.length }))
  return { marks, gaps }
}

describe("the review model, over random plans and operation sequences", () => {
  it("the structural validateEdl holds after any sequence of operations (an empty cut is the one issue left)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const { s, kept, step } of run(seed)) {
        const where = `seed ${seed}, step ${step}`
        const edited = buildEdited(s.base, kept)
        const { issues } = validateEdl(edited)
        expect(issues, where).toEqual(kept.length === 0 ? ["segments is empty"] : [])
        // What is kept is exactly K; what is dropped is the plan's time K does not keep.
        expect(keptSetOf(edited), where).toEqual(kept)
        expect(intersectIntervals(toIntervalSet(edited.dropped ?? []), kept), where).toEqual([])
        expect(cover(edited), where).toEqual(unionIntervals(cover(s.base), kept))
      }
    }
  })

  it("the length the inspector shows, edlDurationMs of the edit, is K's total less its overlap transitions", () => {
    const overlapInto = (seg: Edl["segments"][number]): number =>
      seg.transition?.type === "crossfade"
        ? (seg.transition.durationMs ?? 0)
        : seg.layout?.transition && speakerSwitchOverlaps(seg.layout.transition.type)
          ? (seg.layout.transition.durationMs ?? 0)
          : 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const { s, kept, step } of run(seed)) {
        const edited = buildEdited(s.base, kept)
        const total = kept.reduce((ms, k) => ms + (k.outMs - k.inMs), 0)
        const overlaps = edited.segments.reduce((ms, seg, i) => ms + (i > 0 ? overlapInto(seg) : 0), 0)
        expect(edlDurationMs(edited), `seed ${seed}, step ${step}`).toBe(total - overlaps)
      }
    }
  })

  it("a transition stays where the plan put it: on the piece that starts its plan segment, under that segment's id", () => {
    // Counts the new pieces cut from a segment that carries a transition, so this cannot pass for want of one.
    let splitsOfATransition = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const { s, kept, step } of run(seed)) {
        const edited = buildEdited(s.base, kept)
        edited.segments.forEach((seg, i) => {
          const where = `seed ${seed}, step ${step}, segment ${i} (${seg.id})`
          const p = s.base.segments.findIndex((planSeg) => planSeg.id === seg.id)
          if (p < 0 && i > 0) {
            const owner = s.base.segments.find((planSeg) => planSeg.id === seg.id.slice(0, seg.id.lastIndexOf("@")))
            if (owner?.transition || owner?.layout?.transition) splitsOfATransition++
          }
          const t = seg.transition
          const switchIn = seg.layout?.transition
          if (!t && !switchIn) return
          // A new `<id>@<inMs>` piece never carries one.
          expect(p, `${where}: a new piece carries a transition`).toBeGreaterThanOrEqual(0)
          const plan = s.base.segments[p]
          expect(seg.inMs, where).toBe(plan.inMs)
          // The plan carried that transition into this segment; a clamp only shortens it.
          if (t) {
            expect(t.type, where).toBe(plan.transition?.type)
            expect(t.durationMs ?? 0, where).toBeLessThanOrEqual(plan.transition?.durationMs ?? 0)
          }
          if (switchIn) {
            expect(switchIn.type, where).toBe(plan.layout?.transition?.type)
            expect(switchIn.durationMs ?? 0, where).toBeLessThanOrEqual(plan.layout?.transition?.durationMs ?? 0)
          }
          // Where restored time made a cut continuous there is no blend: a continuous join
          // keeps a transition only where the plan's join was continuous too.
          if (edited.segments[i - 1]?.outMs === seg.inMs) expect(s.base.segments[p - 1]?.outMs, where).toBe(seg.inMs)
        })
      }
    }
    expect(splitsOfATransition, "new pieces cut from a segment that carries a transition").toBeGreaterThan(0)
  })

  it("operations are idempotent", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const { s, kept, op, step } of run(seed)) {
        expect(applyOp(kept, op, s.base, s.transcript, s.offsetMs), `seed ${seed}, step ${step}, ${op.kind}`).toEqual(kept)
      }
    }
  })

  it("a round trip is lossless: no edit is the plan, K → EDL → K, and a saved edit reopens unchanged", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const base = randomBase(rngOf(seed))
      expect(buildEdited(base, keptSetOf(base)), `seed ${seed}`).toStrictEqual(base)
      expect(restoredOf(base, keptSetOf(base)), `seed ${seed}`).toEqual([])
      for (const { s, kept, step } of run(seed)) {
        const where = `seed ${seed}, step ${step}`
        const edited = buildEdited(s.base, kept)
        const saved = persisted(edited)
        expect(saved, where).toStrictEqual(edited)
        expect(JSON.stringify(saved), where).toBe(JSON.stringify(edited))
        expect(buildEdited(s.base, keptSetOf(saved)), where).toStrictEqual(edited)
      }
    }
  })

  it("restored is the plan's dropped time that K keeps, and nothing else", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const { s, kept, step } of run(seed)) {
        const where = `seed ${seed}, step ${step}`
        const restored = restoredOf(s.base, kept)
        expect(toIntervalSet(restored), where).toEqual(intersectIntervals(toIntervalSet(s.base.dropped ?? []), kept))
        for (const r of restored) {
          expect(s.base.dropped?.some((d) => d.reason === r.reason && d.inMs <= r.inMs && r.outMs <= d.outMs), where).toBe(true)
        }
      }
    }
  })

  it("the kept words are exactly the words remapTranscriptThroughEdl keeps", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const indexOf = new Map<string, number>()
      for (const { s, kept, step } of run(seed)) {
        if (indexOf.size === 0) s.transcript.words.forEach((w, i) => indexOf.set(w.text, i))
        const edited = buildEdited(s.base, kept)
        const marks = buildWordIndex(edited, s.transcript).marks
        const ours = marks.flatMap((m, i) => (m.state === "cut" ? [] : [i]))
        const theirs = remapTranscriptThroughEdl(edited, s.transcript).words.map((w) => indexOf.get(w.text))
        expect(ours, `seed ${seed}, step ${step}`).toEqual(theirs)
      }
    }
  })

  it("each word's mark (state, reason, drop) and the gaps are what checking every word against every span gives", () => {
    // How often the runs reach what the sweep must handle: the out-of-order dropped
    // list buildEdited writes (the reviewer's cuts after the plan's spans), and gaps
    // on a transcript whose source is offset.
    let unsortedDropped = 0
    let offsetGaps = 0
    const check = (edl: Edl, transcript: Transcript, where: string): WordIndex => {
      const index = buildWordIndex(edl, transcript)
      expect(index, where).toEqual(wordIndexOracle(edl, transcript))
      return index
    }
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const { s, kept, step } of run(seed)) {
        if (step === 0) check(s.base, s.transcript, `seed ${seed}, the plan`)
        const edited = buildEdited(s.base, kept)
        const { gaps } = check(edited, s.transcript, `seed ${seed}, step ${step}`)
        const drops = edited.dropped ?? []
        if (drops.some((d, i) => i > 0 && d.inMs < drops[i - 1].inMs)) unsortedDropped++
        if (s.offsetMs !== 0 && gaps.length > 0) offsetGaps++
      }
    }
    expect(unsortedDropped, "states whose dropped list is out of time order").toBeGreaterThan(0)
    expect(offsetGaps, "states with gaps on an offset transcript").toBeGreaterThan(0)
  })
})
