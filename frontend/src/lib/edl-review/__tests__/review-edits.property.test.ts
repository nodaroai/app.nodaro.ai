import { beforeEach, describe, it, expect } from "vitest"
import { normalizeEdl, resolveEditPlanOutput, validateEditedEdl, type Edl } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { keptSetOf, type KeptSet } from "../kept-set"
import { resetUndoStacks, undoStackOf } from "../undo-stack"
import { transcriptOffsetMs } from "../word-index"
import { reviewOf } from "../write-review"
import { applyOp, randomBase, randomOp, randomRenderableBase, randomTranscript, rngOf, TIGHTEN_RENDER, type Rng } from "./review-fixtures"

/**
 * The stored review over random plans and operation sequences (A3-2, §6 item 3
 * of the inspectors design): every sequence keeps the stored edit valid on a
 * reviewable plan, the edit round-trips through the database, and undo then
 * redo is the identity.
 */
const SEEDS = 140
const MAX_OPS = 14

/** The K of every step of a random run, with the plan as stored (a JSONB round trip of it). */
function runOf(seed: number, planOf: (rng: Rng) => Edl) {
  const rng = rngOf(seed)
  const base = planOf(rng)
  const plan = JSON.parse(JSON.stringify(base)) as unknown
  const transcript = randomTranscript(rng, base)
  const off = transcriptOffsetMs(base, transcript)
  const states: KeptSet[] = [keptSetOf(base)]
  const steps = rng.int(1, MAX_OPS)
  for (let step = 0; step < steps; step++) {
    const kept = states[states.length - 1]!
    const op = randomOp(rng, base, buildEdited(base, kept), transcript, off)
    states.push(applyOp(kept, op, base, transcript, off, TIGHTEN_RENDER))
  }
  return { base, plan, states }
}

describe("the stored review, over random plans and operation sequences", () => {
  beforeEach(() => resetUndoStacks())

  it("every operation sequence keeps validateEditedEdl ok on a reviewable plan (an empty cut is the one issue left)", () => {
    for (const planOf of [randomBase, randomRenderableBase]) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { base, plan, states } = runOf(seed, planOf)
        states.forEach((kept, step) => {
          const where = `seed ${seed}, step ${step}`
          const review = reviewOf(plan, base, kept)
          if (!review) {
            expect(kept, where).toEqual(keptSetOf(base))
            return
          }
          expect(validateEditedEdl(review, plan).issues, where).toEqual(kept.length === 0 ? ["segments is empty"] : [])
        })
      }
    }
  })

  it("the stored edit round-trips: through JSON it still applies, resolves to the edit and reopens on the same K", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { base, plan, states } = runOf(seed, randomBase)
      states.forEach((kept, step) => {
        const where = `seed ${seed}, step ${step}`
        const review = reviewOf(plan, base, kept)
        if (!review) return
        const stored = JSON.parse(JSON.stringify(review)) as unknown
        const resolved = resolveEditPlanOutput(plan, stored)
        expect(resolved.status, where).toBe("applied")
        expect(normalizeEdl(resolved.json), where).toStrictEqual(buildEdited(base, kept))
        const reopened = keptSetOf({ ...base, segments: (stored as { edl: { segments: Edl["segments"] } }).edl.segments })
        expect(reopened, where).toEqual(kept)
      })
    }
  })

  it("undo then redo is the identity", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { states } = runOf(seed, randomBase)
      const stack = undoStackOf(`plan-${seed}`, "basis")
      for (let i = 1; i < states.length; i++) stack.push(states[i - 1]!)
      let current = states[states.length - 1]!
      for (let i = states.length - 2; i >= 0; i--) {
        current = stack.undo(current)!
        expect(current, `seed ${seed}, undo to ${i}`).toEqual(states[i])
      }
      expect(stack.undo(current), `seed ${seed}`).toBeUndefined()
      for (let i = 1; i < states.length; i++) {
        current = stack.redo(current)!
        expect(current, `seed ${seed}, redo to ${i}`).toEqual(states[i])
      }
      expect(stack.canRedo, `seed ${seed}`).toBe(false)
    }
  })
})
