/**
 * The apply-edl 3-hour output cap (product decision 2026-09-24): "Refuse an
 * EDL whose output exceeds the product's 3-hour cap with a clear 400, so no
 * budget can exceed ~3 h of render time."
 *
 * One constant (`APPLY_EDL_MAX_OUTPUT_MS`, in the pure budget leaf) is read by
 * both halves: ingress refuses a longer edit (`validateEffectiveEdl` — the
 * route, the DAG payload-builder and the MCP verb all call it), and the job's
 * declared budget refuses to size one (`applyEdlJobBudgetMs`), so a payload
 * that bypassed ingress can never be budgeted past a 180-minute output.
 *
 * NOT MET by this cap: "no budget can exceed ~3 h of render time". The cap
 * bounds output LENGTH only; segment and source counts are unbounded and the
 * 20-minute per-chunk kill floor drives the budget past ~30 segments — a valid
 * 180-minute edit of 10,800 one-second cuts is budgeted ~160 h. How to bound
 * that is an open product decision (backend/CLAUDE.md, "The 3-hour output
 * cap"); the "same shape" test below pins only what holds today.
 */
import { describe, it, expect } from "vitest"
import { edlDurationMs, type Edl, type EdlSegment } from "@nodaro/shared"
import { validateEffectiveEdl, APPLY_EDL_MAX_OUTPUT_MS as PLAN_CAP } from "../apply-edl-plan.js"
import {
  APPLY_EDL_MAX_OUTPUT_MS,
  applyEdlJobBudgetMs,
  applyEdlRenderBudgetMs,
} from "../../providers/video/apply-edl-budget.js"
import { declaredJobBudgetMs } from "../job-budget.js"

const MINUTE = 60_000

/** `ms` of output as one-minute hard cuts on one source (the last one shorter). */
function edl(ms: number, crossfadeMs = 0): Edl {
  const segments: EdlSegment[] = []
  for (let at = 0, i = 0; at < ms; at += MINUTE, i++) {
    segments.push({
      id: `s${i}`, inMs: at, outMs: Math.min(ms, at + MINUTE), video: "A",
      ...(i > 0 && crossfadeMs > 0 ? { transition: { type: "crossfade" as const, durationMs: crossfadeMs } } : {}),
    })
  }
  return {
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "https://media.test/episode.mp4", kind: "video" }],
    segments,
  }
}

const capIssue = (issues: readonly string[]) => issues.find((i) => i.includes("-minute limit for one render"))

describe("the cap is ONE constant: 180 minutes", () => {
  it("is 180 minutes, and ingress reads the same binding the budget does", () => {
    expect(APPLY_EDL_MAX_OUTPUT_MS).toBe(180 * MINUTE)
    expect(PLAN_CAP).toBe(APPLY_EDL_MAX_OUTPUT_MS)
  })
})

describe("ingress refuses an edit whose OUTPUT exceeds the cap", () => {
  it("exactly 180 minutes of output passes", () => {
    const v = validateEffectiveEdl(edl(APPLY_EDL_MAX_OUTPUT_MS), "video")
    expect(v.issues).toEqual([])
    expect(v.ok).toBe(true)
  })

  it("one millisecond over is refused, naming the rendered length and the cap", () => {
    const v = validateEffectiveEdl(edl(APPLY_EDL_MAX_OUTPUT_MS + 1), "video")
    expect(v.ok).toBe(false)
    expect(capIssue(v.issues)).toBe(
      "the edit renders 180.1 minutes of output — over the 180-minute limit for one render; split it into parts of at most 180 minutes",
    )
  })

  it("a 4-hour audio cut is refused too (the cap is on every output)", () => {
    const v = validateEffectiveEdl(edl(240 * MINUTE), "audio")
    expect(capIssue(v.issues)).toContain("renders 240 minutes of output")
  })

  it("is measured on the RENDERED output — crossfade overlaps subtracted, like the reserve", () => {
    // 181 one-minute cuts with a 10 s crossfade into each: 181 min of source,
    // 181 − 180 × 10 s = 151 min of output → under the cap.
    const x = edl(181 * MINUTE, 10_000)
    expect(edlDurationMs(x)).toBe(151 * MINUTE)
    expect(capIssue(validateEffectiveEdl(x, "video").issues)).toBeUndefined()
  })
})

describe("no job can be budgeted past a 180-minute output (defensive clamp)", () => {
  it("an over-cap payload declares NO budget — every reader falls back to its default ceiling", () => {
    const over = { edl: edl(APPLY_EDL_MAX_OUTPUT_MS + MINUTE), output: "video" }
    expect(applyEdlJobBudgetMs(over)).toBeUndefined()
    expect(declaredJobBudgetMs("apply-edl", over)).toBeUndefined()
    // The render budget itself would have been larger still — the clamp is what stops it.
    expect(applyEdlRenderBudgetMs(over.edl)).toBeGreaterThan(applyEdlRenderBudgetMs(edl(APPLY_EDL_MAX_OUTPUT_MS)))
  })

  it("an at-cap payload keeps its full budget", () => {
    const atCap = { edl: edl(APPLY_EDL_MAX_OUTPUT_MS), output: "video" }
    expect(applyEdlJobBudgetMs(atCap)).toBe(applyEdlRenderBudgetMs(atCap.edl, { output: "video" }))
  })

  it("for every length, the declared budget never exceeds that of a 180-minute output of the same shape", () => {
    for (const output of ["video", "audio"] as const) {
      const ceiling = applyEdlRenderBudgetMs(edl(APPLY_EDL_MAX_OUTPUT_MS), { output })
      for (const minutes of [1, 30, 90, 179, 180, 181, 240, 600, 24 * 60]) {
        const budget = applyEdlJobBudgetMs({ edl: edl(minutes * MINUTE), output })
        if (minutes > 180) expect(budget, `${minutes} min ${output}`).toBeUndefined()
        else expect(budget!, `${minutes} min ${output}`).toBeLessThanOrEqual(ceiling)
      }
    }
  })
})
