import { describe, it, expect } from "vitest"
import type { Edl } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { spanMinus, toIntervalSet, unionIntervals, type Interval } from "../intervals"
import { keptSetOf, reasonSpans, type KeptSet } from "../kept-set"
import { transcriptOffsetMs } from "../word-index"
import { canRestore, restoreReason, type ReviewRenderContext } from "../restore"
import { applyOp, PLAN_REASONS, randomBase, randomOp, randomRenderableBase, randomTranscript, rngOf, TIGHTEN_RENDER } from "./review-fixtures"

/**
 * restoreReason's fast path (A3-2, §2.4 of the inspectors design): the whole
 * span set in one judgement first, the per-span loop only on a lock. Pinned
 * against the per-span loop it replaces, written here from its contract.
 *
 * When the loop locks nothing, every step it took added no problem the plan or
 * the K before it lacked, so the whole set adds none either: the fast path
 * then returns exactly what the loop returns. When the loop locks something,
 * the fast path IS the loop.
 */
function perSpanLoop(kept: KeptSet, base: Edl, reason: string, render: ReviewRenderContext) {
  const spans = reasonSpans(base, reason)
  let current = kept
  let locked: Array<{ span: Interval; reason: string }> = []
  const keepsAll = (k: KeptSet, span: Interval) => spanMinus(span, k).length === 0
  for (let restored = true; restored; ) {
    restored = false
    locked = []
    for (const span of spans) {
      if (keepsAll(current, span)) continue
      const verdict = canRestore(base, current, span, render)
      if (verdict.ok) {
        current = unionIntervals(current, toIntervalSet([span]))
        restored = true
      } else {
        for (const piece of spanMinus(span, current)) locked.push({ span: piece, reason: verdict.reason })
      }
    }
  }
  return { kept: current, locked }
}

const SEEDS = 120
const REASONS = [...PLAN_REASONS, "manual"]

describe("restoreReason's fast path", () => {
  for (const [name, planOf] of [
    ["renderable plans", randomRenderableBase],
    ["any valid plan", randomBase],
  ] as const) {
    it(`gives what the per-span loop gives, on ${name}, from any K the review reaches`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = rngOf(seed)
        const base = planOf(rng)
        const transcript = randomTranscript(rng, base)
        const off = transcriptOffsetMs(base, transcript)
        let kept = keptSetOf(base)
        const steps = rng.int(0, 8)
        for (let step = 0; step < steps; step++) {
          kept = applyOp(kept, randomOp(rng, base, buildEdited(base, kept), transcript, off), base, transcript, off, TIGHTEN_RENDER)
        }
        for (const reason of REASONS) {
          const where = `seed ${seed}, ${reason}`
          const fast = restoreReason(kept, base, reason, TIGHTEN_RENDER)
          const loop = perSpanLoop(kept, base, reason, TIGHTEN_RENDER)
          expect(fast.kept, where).toEqual(loop.kept)
          expect(fast.locked.map((l) => ({ span: l.span, reason: l.reason })), where).toEqual(loop.locked)
        }
      }
    })
  }
})
