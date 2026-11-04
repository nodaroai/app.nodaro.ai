import { describe, expect, it } from "vitest"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { listOf, runDetailOf, runOfRow, totalOfRow } from "../wire.js"

const RUN = "00000000-0000-4000-8000-0000000000a1"
const USER = "00000000-0000-4000-8000-0000000000e1"
const OTHER_RUN = "00000000-0000-4000-8000-0000000000b2"
const job = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`

/** A run as admin_motion_runs answers it over PostgREST (numerics may come as strings). */
function runRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN, created_at: "2026-11-02T10:00:00+00:00", user_id: USER, email: "person@example.test", status: "completed",
    full_quality: false, draft_job_id: null, kind: "trend", trend_name: "Dance", engine: "prism", style: "precise",
    resolution: "720p", draft: false, length_sec: "4", held: "3670", taken: "1063", settled: true,
    taken_usd: "2.126", recorded_usd: "1.25", kie_usd: null, paid_usd: "1.25", margin_usd: "0.876", margin_pct: "41.2041",
    steps: 5, steps_without_cost: 0, quote: null, quote_total: "1200", reuse: null, extras: null, quote_allowed: "1250",
    flag_paid_above_taken: false, flag_missing_cost: false, flag_above_quote: false, flagged: false,
    ...over,
  }
}

describe("runOfRow", () => {
  it("turns snake_case into camelCase and numeric strings into numbers", () => {
    expect(runOfRow(runRow())).toEqual({
      id: RUN, createdAt: "2026-11-02T10:00:00+00:00", userId: USER, email: "person@example.test", status: "completed",
      fullQuality: false, draftJobId: null, kind: "trend", trendName: "Dance", engine: "prism", style: "precise",
      resolution: "720p", draft: false, lengthSec: 4, held: 3670, taken: 1063, settled: true,
      takenUsd: 2.126, recordedUsd: 1.25, kieUsd: null, paidUsd: 1.25, marginUsd: 0.876, marginPct: 41.2041,
      steps: 5, stepsWithoutCost: 0, quoteTotal: 1200, quoteAllowed: 1250,
      flags: { paidAboveTaken: false, missingCost: false, aboveQuote: false },
    })
  })

  it("maps quote_allowed to quoteAllowed, and each flag", () => {
    const run = runOfRow(runRow({ quote_allowed: 1300, flag_paid_above_taken: true, flag_missing_cost: true, flag_above_quote: true }))
    expect(run.quoteAllowed).toBe(1300)
    expect(run.flags).toEqual({ paidAboveTaken: true, missingCost: true, aboveQuote: true })
  })

  it("a run still in flight: its taken is the running total, no difference, no flag", () => {
    const run = runOfRow(runRow({ settled: false, taken: 106, taken_usd: 0.212, margin_usd: null, margin_pct: null, paid_usd: 0 }))
    expect(run).toMatchObject({ settled: false, taken: 106, takenUsd: 0.212, marginUsd: null, marginPct: null, paidUsd: 0 })
    expect(run.flags).toEqual({ paidAboveTaken: false, missingCost: false, aboveQuote: false })
  })

  it("reads nothing it cannot: a missing figure is null, a Full Quality try keeps its draft", () => {
    const run = runOfRow(runRow({
      held: null, taken: "x", length_sec: undefined, quote_total: null, quote_allowed: null, email: null,
      full_quality: true, draft_job_id: OTHER_RUN, kind: "hand", trend_name: null, engine: "pulse", style: "flex",
    }))
    expect(run).toMatchObject({
      held: null, taken: null, lengthSec: null, quoteTotal: null, quoteAllowed: null, email: null,
      fullQuality: true, draftJobId: OTHER_RUN, kind: "hand", trendName: null, engine: "pulse", style: "flex",
    })
  })
})

describe("totalOfRow", () => {
  it("maps a group's row", () => {
    expect(totalOfRow({
      dimension: "engine", value: "pulse", runs: 3, unsettled: "1", held: "9534", taken: 3864, taken_usd: "7.728",
      paid_usd: 9.567, margin_usd: "-1.839", margin_pct: -23.7966,
    })).toEqual({
      dimension: "engine", value: "pulse", runs: 3, unsettled: 1, held: 9534, taken: 3864, takenUsd: 7.728,
      paidUsd: 9.567, marginUsd: -1.839, marginPct: -23.7966,
    })
  })

  it("a group with no settled run sums to null, never 0", () => {
    expect(totalOfRow({
      dimension: "resolution", value: null, runs: 1, unsettled: 1, held: null, taken: null, taken_usd: null,
      paid_usd: null, margin_usd: null, margin_pct: null,
    })).toEqual({
      dimension: "resolution", value: null, runs: 1, unsettled: 1, held: null, taken: null, takenUsd: null,
      paidUsd: null, marginUsd: null, marginPct: null,
    })
  })
})

describe("listOf", () => {
  it("maps the list function's answer, and says whether KIE's figures were applied", () => {
    const list = listOf({ total: "1", runs: [runRow()], totals: [{ dimension: "all", value: null, runs: 1, unsettled: 0 }] }, true)
    expect(list.total).toBe(1)
    expect(list.runs).toEqual([runOfRow(runRow())])
    expect(list.totals[0]).toMatchObject({ dimension: "all", value: null, runs: 1, unsettled: 0 })
    expect(list.kieApplied).toBe(true)
  })

  it("an empty or malformed answer is an empty list", () => {
    expect(listOf(null, false)).toEqual({ total: 0, runs: [], totals: [], kieApplied: false })
    expect(listOf({ total: 2, runs: "x", totals: [null, 3] }, false)).toEqual({ total: 2, runs: [], totals: [], kieApplied: false })
  })
})

type Tree = Record<string, unknown>
const at = (minute: number, second = 0) => `2026-11-02T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+00:00`

/** A tree row as admin_motion_tree answers it. */
function treeRow(n: number, over: Tree): Tree {
  return {
    run_id: RUN, job_id: job(n), parent_job_id: RUN, depth: 1, route: "image-to-image", step_key: null, provider: "kie",
    model: null, provider_task_id: null, status: "completed", created_at: at(1), held: 0, log_status: "committed", taken: 0,
    recorded_usd: null, kie_usd: null, paid_usd: null, is_local: false, no_cost: false,
    ...over,
  }
}

const QUOTE = {
  v: 1, totalCredits: 1200, expectedCredits: 1000,
  breakdown: { base: 40, motion: 1000, motionExpected: 800, references: 100, prompt: 10, privacy: 50, faceMesh: 0, aaa: 1 },
  privacyCredits: 50, referencesRetryCredits: 30,
}

// In the order admin_motion_tree answers (depth, then time): the masking steps (depth 2) come last.
const TREE: Tree[] = [
  treeRow(0, { job_id: RUN, parent_job_id: null, depth: 0, route: "cast-swap", step_key: "client-key-1", provider: null,
    created_at: at(0), held: 40, taken: 40, paid_usd: 0, is_local: true }),
  treeRow(1, { route: "llm-chat", step_key: `cast-swap-llm:${RUN}:photo-labels:0:1:0a1b2c3d`, created_at: at(0, 30), held: 4, taken: 2, recorded_usd: 0.001, paid_usd: 0.001 }),
  treeRow(2, { step_key: `cast-swap-prep:${RUN}:0`, created_at: at(1), held: 30, taken: 20, recorded_usd: 0.04, paid_usd: 0.04 }),
  treeRow(3, { route: "generate-video", step_key: `cast-swap-child:${RUN}`, model: "seedance-2-5", provider_task_id: "kie-task-1",
    created_at: at(2), held: 1000, taken: 800, recorded_usd: 1.5, kie_usd: 1.4, paid_usd: 1.4 }),
  treeRow(6, { step_key: `cast-swap-prep:${RUN}:1:regen`, created_at: at(5), held: 30, taken: 30, recorded_usd: 0.04, paid_usd: 0.04 }),
  treeRow(7, { route: "generate-image", created_at: at(6), held: 5, taken: 5, no_cost: true }),
  treeRow(8, { route: "llm-chat", step_key: `cast-swap-llm:${RUN}:engine-prompt:run:1:0a1b2c3d`, created_at: at(7), held: 10,
    log_status: "reserved", taken: null }),
  treeRow(4, { parent_job_id: job(3), depth: 2, route: "video-mask", step_key: `cast-swap-mask:${RUN}:retry`, created_at: at(3),
    held: 50, taken: 50, recorded_usd: 0.05, paid_usd: 0.05 }),
  treeRow(5, { parent_job_id: job(3), depth: 2, route: "video-face-mesh", step_key: `cast-swap-face-mesh:${RUN}:retry`, created_at: at(4),
    is_local: true, paid_usd: 0 }),
]

describe("runDetailOf", () => {
  const detail = runDetailOf(
    runRow({ quote: QUOTE, extras: { v: 1, ran: ["privacyCredits"] }, reuse: { v: 1, entries: [{ step: "clip", ref: "0123456789ab" }, { step: "clip", ref: "ba9876543210" }, { step: "clip" }] } }),
    TREE,
  )

  it("carries the run as the list reads it", () => {
    expect(detail.run).toEqual(runOfRow(runRow()))
  })

  it("lists the quote's lines in their order, the unknown ones by name, then the extras outside the hold", () => {
    expect(detail.quote?.totalCredits).toBe(1200)
    expect(detail.quote?.expectedCredits).toBe(1000)
    expect(detail.quote?.lines.map((l) => [l.line, l.label, l.outsideTotal])).toEqual([
      ["base", "Base fee", false],
      ["motion", "Render", false],
      ["references", "References", false],
      ["prompt", "Prompt writing", false],
      ["privacy", "Privacy", false],
      ["aaa", "aaa", false],
      ["faceMesh", "faceMesh", false],
      ["privacyCredits", "Privacy retry", true],
      ["referencesRetryCredits", "Sheet retry", true],
    ])
  })

  it("an extra's label names it once: being outside the hold is the line's flag, never its words", () => {
    const lines = detail.quote?.lines ?? []
    expect(lines.filter((l) => l.outsideTotal).map((l) => [l.line, l.label])).toEqual([
      ["privacyCredits", "Privacy retry"],
      ["referencesRetryCredits", "Sheet retry"],
    ])
    expect(lines.filter((l) => /outside the hold/i.test(l.label))).toEqual([])
  })

  it("expected sits on the motion line; motionExpected is no line of its own", () => {
    const lines = detail.quote?.lines ?? []
    expect(lines.find((l) => l.line === "motion")).toMatchObject({ quoted: 1000, expected: 800 })
    expect(lines.filter((l) => l.line !== "motion").every((l) => l.expected === null)).toBe(true)
    expect(lines.some((l) => l.line === "motionExpected")).toBe(false)
  })

  it("each quote line carries the steps mapped to it: their count, held and taken (an open step's taken as 0)", () => {
    const sums = Object.fromEntries((detail.quote?.lines ?? []).map((l) => [l.line, [l.quoted, l.steps, l.held, l.taken]]))
    expect(sums).toEqual({
      base: [40, 1, 40, 40],
      motion: [1000, 1, 1000, 800],
      references: [100, 2, 34, 22],
      prompt: [10, 1, 10, 0],
      privacy: [50, 0, 0, 0],
      aaa: [1, 0, 0, 0],
      faceMesh: [0, 0, 0, 0],
      privacyCredits: [50, 2, 50, 50],
      referencesRetryCredits: [30, 1, 30, 30],
    })
  })

  it("an extra counts only when it ran", () => {
    const ran = (d: typeof detail) => Object.fromEntries((d.quote?.lines ?? []).map((l) => [l.line, l.ran]))
    expect(ran(detail)).toMatchObject({ base: null, motion: null, privacyCredits: true, referencesRetryCredits: false })
    const noRecord = runDetailOf(runRow({ quote: QUOTE, extras: null }), TREE)
    expect(ran(noRecord)).toMatchObject({ privacyCredits: false, referencesRetryCredits: false })
  })

  it("lists the steps depth 0 first, then by when they started", () => {
    expect(detail.steps.map((s) => s.name)).toEqual([
      "Run", "Photo labels", "Reference sheet", "Render", "Face mask (retry)", "Face mesh (retry)",
      "Reference sheet", "Other step (generate-image)", "Engine prompt",
    ])
  })

  it("gives each step its figures, its tags and its quote line", () => {
    const byName = (name: string) => detail.steps.find((s) => s.name === name)
    expect(byName("Render")).toEqual({
      jobId: job(3), parentJobId: RUN, depth: 1, name: "Render", role: null, route: "generate-video", provider: "kie",
      model: "seedance-2-5", providerTaskId: "kie-task-1", status: "completed", held: 1000, taken: 800, open: false,
      takenUsd: 800 * CREDIT_BASE_USD, recordedUsd: 1.5, kieUsd: 1.4, paidUsd: 1.4, local: false, missingCost: false,
      quoteLine: "motion",
    })
    expect(byName("Run")).toMatchObject({ depth: 0, local: false, quoteLine: "base", paidUsd: 0, takenUsd: 40 * CREDIT_BASE_USD })
    expect(byName("Engine prompt")).toMatchObject({ open: true, taken: null, takenUsd: null, quoteLine: "prompt" })
    expect(byName("Other step (generate-image)")).toMatchObject({ missingCost: true, quoteLine: null, paidUsd: null })
    expect(byName("Face mesh (retry)")).toMatchObject({ local: true, quoteLine: "privacyCredits", paidUsd: 0 })
    expect(detail.steps.filter((s) => s.name === "Reference sheet").map((s) => [s.role, s.quoteLine])).toEqual([
      [0, "references"],
      [1, "referencesRetryCredits"],
    ])
  })

  it("three kept clips are one row with count 3", () => {
    expect(detail.reuse).toEqual({
      recorded: "yes",
      entries: [{ step: "clip", name: "Engine-ready clip (kept, local work)", role: null, jobId: null, count: 3, quoteLine: null }],
    })
  })

  it("an empty reuse record is a record: yes with no entries, which the drawer reads as Nothing reused", () => {
    expect(runDetailOf(runRow({ quote: QUOTE, reuse: { v: 1, entries: [] } }), TREE).reuse).toEqual({ recorded: "yes", entries: [] })
    expect(runDetailOf(runRow({ reuse: { v: 1, entries: [] } }), TREE).reuse).toEqual({ recorded: "yes", entries: [] })
  })

  it("reuse is none with a quote and no record, not-recorded with neither", () => {
    expect(runDetailOf(runRow({ quote: QUOTE }), TREE).reuse).toEqual({ recorded: "none", entries: [] })
    expect(runDetailOf(runRow(), TREE).reuse).toEqual({ recorded: "not-recorded", entries: [] })
    expect(runDetailOf(runRow({ quote: { v: 2, totalCredits: 10 }, reuse: { v: 2, entries: [] } }), TREE).reuse.recorded).toBe("not-recorded")
  })

  it("without a recorded quote: no quote, and no step on a line", () => {
    const bare = runDetailOf(runRow(), TREE)
    expect(bare.quote).toBeNull()
    expect(bare.steps.every((s) => s.quoteLine === null)).toBe(true)
  })

  it("a scene step is privacy on a depth-map run: a depth-map step, or the trend's stored map reused", () => {
    const scene = treeRow(9, { route: "llm-chat", step_key: `cast-swap-llm:${RUN}:scene-description:run:1:0a1b2c3d`, created_at: at(8) })
    const depthMap = treeRow(10, { route: "video-depth", step_key: `cast-swap-depth-clip:${RUN}:first`, created_at: at(9) })
    const sceneLine = (d: ReturnType<typeof runDetailOf>) => d.steps.find((s) => s.name === "Scene description")?.quoteLine
    expect(sceneLine(runDetailOf(runRow({ quote: QUOTE }), [...TREE, scene]))).toBe("prompt")
    expect(sceneLine(runDetailOf(runRow({ quote: QUOTE }), [...TREE, scene, depthMap]))).toBe("privacy")
    expect(sceneLine(runDetailOf(runRow({ quote: QUOTE, reuse: { v: 1, entries: [{ step: "depth" }] } }), [...TREE, scene]))).toBe("privacy")
  })

  it("steps that started at the same moment go by job id; another run's rows are left out", () => {
    const tied = [treeRow(12, { created_at: at(1) }), treeRow(11, { created_at: at(1) }), treeRow(13, { run_id: OTHER_RUN, created_at: at(0) })]
    expect(runDetailOf(runRow(), tied).steps.map((s) => s.jobId)).toEqual([job(11), job(12)])
  })

  describe("an \"auto\" masking quote's privacy line sits outside the hold", () => {
    const linesOf = (quote: Record<string, unknown>) =>
      (runDetailOf(runRow({ quote }), TREE).quote?.lines ?? []).map((l) => [l.line, l.quoted, l.outsideTotal, l.ran])

    it("auto: the masking is quoted beside the hold, so the other lines make the hold exactly — privacy is outside", () => {
      const auto = { v: 1, totalCredits: 1140, expectedCredits: 940, breakdown: { base: 40, motion: 1000, motionExpected: 800, references: 100, privacy: 50 }, privacyCredits: 50 }
      expect(linesOf(auto)).toEqual([
        ["base", 40, false, null],
        ["motion", 1000, false, null],
        ["references", 100, false, null],
        ["privacy", 50, true, null],
        ["privacyCredits", 50, true, false],
      ])
    })

    it("Full depth: privacy in the hold beside its own privacyCredits stays inside, even when the two figures coincide", () => {
      const fullDepth = { v: 1, totalCredits: 1210, breakdown: { base: 40, motion: 1000, references: 100, privacy: 70 }, privacyCredits: 70 }
      expect(linesOf(fullDepth)).toEqual([
        ["base", 40, false, null],
        ["motion", 1000, false, null],
        ["references", 100, false, null],
        ["privacy", 70, false, null],
        ["privacyCredits", 70, true, false],
      ])
    })

    it("always: privacy in the hold with no extra stays inside; a privacy of 0 stays inside", () => {
      const always = { v: 1, totalCredits: 1190, breakdown: { base: 40, motion: 1000, references: 100, privacy: 50 } }
      expect(linesOf(always).find((l) => l[0] === "privacy")).toEqual(["privacy", 50, false, null])
      const stored = { v: 1, totalCredits: 1140, breakdown: { base: 40, motion: 1000, references: 100, privacy: 0 }, privacyCredits: 0 }
      expect(linesOf(stored).find((l) => l[0] === "privacy")).toEqual(["privacy", 0, false, null])
    })

    it("a quote with no privacy line is unchanged", () => {
      const none = { v: 1, totalCredits: 1140, breakdown: { base: 40, motion: 1000, references: 100 }, privacyCredits: 50 }
      expect(linesOf(none)).toEqual([
        ["base", 40, false, null],
        ["motion", 1000, false, null],
        ["references", 100, false, null],
        ["privacyCredits", 50, true, false],
      ])
    })
  })

  it("a step whose line the quote does not carry is on no line, and sums into none", () => {
    const bare = runDetailOf(runRow({ quote: { v: 1, totalCredits: 1040, breakdown: { base: 40, motion: 1000 } } }), TREE)
    expect(bare.steps.find((s) => s.name === "Engine prompt")?.quoteLine).toBeNull()
    expect(bare.steps.find((s) => s.name === "Photo labels")?.quoteLine).toBeNull()
    expect(bare.steps.find((s) => s.name === "Render")?.quoteLine).toBe("motion")
    expect(bare.quote?.lines.map((l) => [l.line, l.steps])).toEqual([["base", 1], ["motion", 1]])
  })

  it("a Full Quality try's own row is Full Quality", () => {
    const d = runDetailOf(runRow({ full_quality: true, draft_job_id: OTHER_RUN }), [TREE[0]!])
    expect(d.steps[0]).toMatchObject({ name: "Full Quality", depth: 0 })
  })
})
