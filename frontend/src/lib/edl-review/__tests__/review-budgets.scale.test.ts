import { describe, it, expect, vi } from "vitest"

// Count the expensive steps: a run of the render rule (a full pass over the
// edit) and the edit it judges (buildEdited, a full pass over the plan). Plain
// counters, not vi.fn: a mock keeps every call's arguments, whole EDLs, and a
// span-by-span restore makes thousands of calls.
const calls = vi.hoisted(() => ({ ruleRuns: 0, builds: 0 }))
vi.mock("../build-edited", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../build-edited")>()
  return {
    ...actual,
    buildEdited: (...args: Parameters<typeof actual.buildEdited>) => {
      calls.builds++
      return actual.buildEdited(...args)
    },
  }
})
vi.mock("@nodaro/render-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/render-rules")>()
  return {
    ...actual,
    findEffectiveEdlIssues: (...args: Parameters<typeof actual.findEffectiveEdlIssues>) => {
      calls.ruleRuns++
      return actual.findEffectiveEdlIssues(...args)
    },
  }
})

import type { Edl } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { cutRange, cutReason, keptSetOf, reasonSpans } from "../kept-set"
import { transcriptOffsetMs } from "../word-index"
import { canRestore, restoreReason } from "../restore"
import {
  budgetMs,
  fastestMs,
  sessionOf,
  threeHourSession,
  THREE_HOUR_BLOCKS,
  THREE_HOUR_FILLERS,
  THREE_HOUR_RENDER,
} from "./three-hour-fixture"

/**
 * The inspector's budgets (§2.4 of the inspectors design), on the 3-hour
 * episode: 30k words, 3k dropped spans, 844 of them fillers.
 *
 * Two kinds of check. THE SHAPE of each operation is pinned by counts that do
 * not depend on the machine: how many runs of the render rule a restore costs,
 * and how many times a cut or a build reads each element of its inputs, at two
 * episode lengths. A restore of a whole reason that judged span by span (844
 * rule runs, quadratic in the episode) fails these on any machine.
 *
 * THE LATENCY is the design's own budgets, each the fastest of a few runs so
 * the figure is the work's cost, not the machine's noise:
 *
 *  - ≤ 16 ms for a cut (the pure operation);
 *  - ≤ 50 ms for one restore judgement;
 *  - ≤ 300 ms for restoring every filler (`restoreReason`'s fast path: one
 *    judgement of the whole set).
 *
 * They are targets for real machines; under coverage and on the CI runner
 * they are scaled by `budgetMs` (three-hour-fixture.ts says by how much, and why).
 */
const { base, transcript } = threeHourSession()
const K0 = keptSetOf(base)
const off = transcriptOffsetMs(base, transcript)

const HALF_BLOCKS = THREE_HOUR_BLOCKS / 2
// Under a span-by-span restore one `restoreReason` takes seconds; let the
// count assertion, not the test timeout, be what fails.
const SLOW_IF_QUADRATIC = 120_000

/** Runs of the render rule, and edits built, while `fn` runs. */
function costOf(fn: () => void): { ruleRuns: number; builds: number } {
  const before = { ...calls }
  fn()
  return { ruleRuns: calls.ruleRuns - before.ruleRuns, builds: calls.builds - before.builds }
}

/** `items`, counting every element read (indexing, iteration, spreads). */
function counted<T>(items: readonly T[], tally: { reads: number }): readonly T[] {
  return new Proxy(items as T[], {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) tally.reads++
      return Reflect.get(target, key, receiver)
    },
  })
}

describe("the 3-hour fixture", () => {
  it("is the episode the budgets name", () => {
    expect(transcript.words.length).toBeGreaterThanOrEqual(29_000)
    expect(base.dropped!.length).toBe(3000)
    expect(base.dropped!.filter((d) => d.reason === "filler").length).toBe(THREE_HOUR_FILLERS)
  })
})

describe("the shape of the work, whatever the machine", () => {
  for (const blocks of [HALF_BLOCKS, THREE_HOUR_BLOCKS]) {
    it(`one restore judgement is one run of the render rule, plus the plan's own once per plan (${blocks} blocks)`, () => {
      const s = sessionOf(blocks)
      const k0 = keptSetOf(s.base)
      const filler = s.base.dropped!.find((d) => d.reason === "filler")!
      let ok = false
      const first = costOf(() => (ok = canRestore(s.base, k0, filler, THREE_HOUR_RENDER).ok))
      expect(ok).toBe(true)
      // The plan's problems (cached by plan object), then the restored edit.
      expect(first.ruleRuns).toBeGreaterThanOrEqual(1)
      expect(first.ruleRuns).toBeLessThanOrEqual(2)
      expect(first.builds).toBe(first.ruleRuns)
      expect(costOf(() => canRestore(s.base, k0, filler, THREE_HOUR_RENDER))).toEqual({ ruleRuns: 1, builds: 1 })
    })

    it(
      `restoring every filler costs what one judgement costs, however many fillers there are (${blocks} blocks)`,
      () => {
        const s = sessionOf(blocks)
        const fillers = reasonSpans(s.base, "filler").length
        expect(fillers).toBeGreaterThanOrEqual(500)
        let result = { kept: keptSetOf(s.base), locked: [] as readonly unknown[] }
        const cost = costOf(() => {
          result = restoreReason(keptSetOf(s.base), s.base, "filler", THREE_HOUR_RENDER)
        })
        // The plan's problems, then the whole set in one judgement. Span by span
        // it is one run per filler at least: 500 here, 844 on the full episode.
        expect(cost.ruleRuns).toBeGreaterThanOrEqual(1)
        expect(cost.ruleRuns).toBeLessThanOrEqual(2)
        expect(cost.builds).toBeLessThanOrEqual(2)
        expect(result.locked).toEqual([])
        expect(cutReason(result.kept, s.base, "filler")).toEqual(keptSetOf(s.base))
      },
      SLOW_IF_QUADRATIC,
    )
  }

  it("a cut reads each word at most twice and each kept interval at most once", () => {
    for (const blocks of [HALF_BLOCKS, THREE_HOUR_BLOCKS]) {
      const s = sessionOf(blocks)
      const k0 = keptSetOf(s.base)
      const offset = transcriptOffsetMs(s.base, s.transcript)
      const words = s.transcript.words
      const mid = Math.floor(words.length / 2)
      const range = { inMs: words[mid]!.startMs + offset, outMs: words[mid + 5]!.endMs + offset }
      const wordReads = { reads: 0 }
      const keptReads = { reads: 0 }
      const after = cutRange(counted(k0, keptReads), range, counted(words, wordReads), offset)
      expect(after).not.toEqual(k0)
      // One pass to snap the range, one to find no word straddling its ends.
      expect(wordReads.reads, `${blocks} blocks`).toBeLessThanOrEqual(2 * words.length)
      expect(keptReads.reads, `${blocks} blocks`).toBeLessThanOrEqual(k0.length)
    }
  })

  it("building the edit reads its inputs O(n log n) times, so doubling the episode about doubles the reads", () => {
    const readsAt = (blocks: number): { reads: number; n: number } => {
      const s = sessionOf(blocks)
      const offset = transcriptOffsetMs(s.base, s.transcript)
      const kept = cutRange(keptSetOf(s.base), { inMs: 100_000, outMs: 101_000 }, s.transcript.words, offset)
      const tally = { reads: 0 }
      const plan: Edl = { ...s.base, segments: counted(s.base.segments, tally) as Edl["segments"], dropped: counted(s.base.dropped!, tally) as Edl["dropped"] }
      buildEdited(plan, counted(kept, tally))
      return { reads: tally.reads, n: s.base.segments.length + s.base.dropped!.length + kept.length }
    }
    const half = readsAt(HALF_BLOCKS)
    const full = readsAt(THREE_HOUR_BLOCKS)
    // Each dropped span finds its place in K by binary search: n log n, never n².
    expect(full.reads).toBeLessThanOrEqual(2 * full.n * Math.ceil(Math.log2(full.n)))
    // Twice the episode: a little over twice the reads (n log n), never four times (n²).
    expect(full.reads / half.reads).toBeLessThan(2.5)
  })
})

describe("budgets on the 3-hour fixture", () => {
  it("a cut takes at most 16 ms", () => {
    const words = transcript.words
    const mid = Math.floor(words.length / 2)
    const range = { inMs: words[mid]!.startMs + off, outMs: words[mid + 5]!.endMs + off }
    let after = K0
    const ms = fastestMs(() => {
      after = cutRange(K0, range, words, off)
    })
    expect(after).not.toEqual(K0)
    expect(ms).toBeLessThanOrEqual(budgetMs(16))
  })

  it("one restore judgement takes at most 50 ms", () => {
    const filler = base.dropped!.find((d) => d.reason === "filler")!
    let ok = false
    const ms = fastestMs(() => {
      ok = canRestore(base, K0, filler, THREE_HOUR_RENDER).ok
    })
    expect(ok).toBe(true)
    expect(ms).toBeLessThanOrEqual(budgetMs(50))
  })

  it(
    "restoring all 844 fillers takes at most 300 ms, and keeps every one",
    () => {
      let result = restoreReason(K0, base, "filler", THREE_HOUR_RENDER)
      const ms = fastestMs(() => {
        result = restoreReason(K0, base, "filler", THREE_HOUR_RENDER)
      }, 3)
      expect(result.locked).toEqual([])
      expect(cutReason(result.kept, base, "filler")).toEqual(K0)
      expect(reasonSpans(base, "filler").length).toBe(THREE_HOUR_FILLERS)
      expect(ms).toBeLessThanOrEqual(budgetMs(300))
    },
    SLOW_IF_QUADRATIC,
  )

  it("the edit a cut gives builds well inside the frame (buildEdited over 3k segments)", () => {
    const k = cutRange(K0, { inMs: 100_000, outMs: 101_000 }, transcript.words, off)
    const ms = fastestMs(() => {
      buildEdited(base, k)
    })
    expect(ms).toBeLessThanOrEqual(budgetMs(50))
  })
})
