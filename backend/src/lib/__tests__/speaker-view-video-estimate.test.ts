/**
 * A Speaker View fed a plain video (video mode, decided 2026-10-11) is
 * ESTIMATED at what its run reserves. The run measures the clip, cuts it whole
 * (`buildSpeakerViewPayload` over `wholeClipEdl`) and reserves the per-minute
 * rate × the clip's minutes on the row of its tier (`speakerViewBaseCredits`).
 * Every estimate reads the render-length rule (`resolveApplyEdlEstimateLength`)
 * and the tier rule (`renderEstimateCreditId`): the editor's pill and confirm,
 * the server's run estimate and a listing. With no `edl` wire the length rule
 * used to fall to the one-minute floor, so an hour-long clip was quoted at one
 * minute and reserved at sixty.
 *
 * The constraint pinned here: estimate ≥ reserve, at base prices, for every
 * length, layout and speaker count, through the real payload builder.
 */
import { describe, it, expect, vi } from "vitest"

// The reserve is what a run makes once video mode is live (R15: Speaker View
// AND Speaker Frames priced); the estimate must already be honest by then.
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) =>
  (await import("../../__tests__/helpers/speaker-view-video-gate-mock.js")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag),
)
import { EDIT_PLAN_MAX_MINUTES, type SpeakerViewCreditId } from "@nodaro/shared"
import { renderEstimateCreditId, resolveApplyEdlEstimateLength, resolveApplyEdlEstimateMinutes } from "@nodaro/render-rules"
import { buildSpeakerViewPayload } from "../../services/workflow-engine/speaker-view-payload.js"
import { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE, speakerViewBaseCredits } from "../speaker-view-plan.js"
import { CreditsService } from "../../ee/billing/credits.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const VIDEO = "https://cdn.example.test/uploads/videos/pod.mp4"
const words = (labels: string[]) => ({
  version: 1,
  words: labels.map((speaker, i) => ({ text: "hi", startMs: i * 5_000, endMs: i * 5_000 + 400, speaker })),
})
const SPEAKERS = [["Alex"], ["Alex", "Sam"], ["Alex", "Sam", "Kim"]]

/** upload → transcribe → Speaker View, the video on `video`. */
function videoGraph(rec: Record<string, unknown>, view: Record<string, unknown> = {}) {
  const nodes: N[] = [
    { id: "rec", type: "upload-video", data: { url: VIDEO, ...rec } },
    { id: "tx", type: "transcribe", data: {} },
    { id: "sv", type: "speaker-view", data: view },
  ]
  const edges: E[] = [
    { source: "rec", target: "tx", sourceHandle: "video", targetHandle: "media" },
    { source: "tx", target: "sv", sourceHandle: "json", targetHandle: "transcript" },
    { source: "rec", target: "sv", sourceHandle: "video", targetHandle: "video" },
  ]
  return { nodes, edges, sv: nodes[2]! }
}
const ALL = new Set(["tx", "sv"])
const NONE: ReadonlySet<string> = new Set()
const secOf = (minutes: number) => ({ metadata: { durationSeconds: minutes * 60 } })

/** What the run reserves (base credits) for a clip of `minutes`, through the real builder. */
function reserve(view: Record<string, unknown>, labels: string[], minutes: number) {
  const built = buildSpeakerViewPayload({
    jobId: "j",
    nodeId: "sv",
    data: view,
    videoUrl: VIDEO,
    transcript: words(labels),
    clip: { durationMs: Math.round(minutes * 60_000), width: 1920, height: 1080 },
  })
  const id = built.creditId as SpeakerViewCreditId
  return { id, base: speakerViewBaseCredits(built.payload.edl as never, id) }
}
const rate = (id: string | undefined) => SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[id as SpeakerViewCreditId]

describe("the render length of a whole clip", () => {
  it.each([0.5, 1, 7, 45.5, 179])("a %s-minute upload estimates at the minutes its run reserves", (minutes) => {
    const g = videoGraph(secOf(minutes))
    const est = resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, ALL)
    expect(est).toBe(Math.max(1, Math.ceil(minutes)))
    // A single-node estimate (the pill) reads the same clip.
    expect(resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, NONE)).toBe(est)
  })

  it("never the one-minute floor: an unknown length prices the ceiling, per minute in a listing", () => {
    const g = videoGraph({})
    expect(resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, ALL)).toBe(EDIT_PLAN_MAX_MINUTES)
    expect(resolveApplyEdlEstimateLength(g.sv, g.nodes, g.edges, ALL)).toEqual({ fixedMinutes: 0, perEpisodeMinute: 1 })
  })

  it("caps at the 180 minutes a run accepts", () => {
    const g = videoGraph(secOf(300))
    expect(resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, ALL)).toBe(EDIT_PLAN_MAX_MINUTES)
  })

  it("a render upstream: that render's length (an Apply EDL's inline 12-minute cut)", () => {
    const g = videoGraph({})
    const seg = { id: "s", inMs: 0, outMs: 12 * 60_000, video: "v" }
    const ae: N = { id: "ae", type: "apply-edl", data: { edl: { version: 1, clock: "master", sources: [{ id: "v", url: VIDEO, kind: "video" }], segments: [seg] } } }
    const edges = g.edges.map((e) => (e.targetHandle === "video" ? { ...e, source: "ae" } : e))
    expect(resolveApplyEdlEstimateMinutes(g.sv, [...g.nodes, ae], edges, ALL)).toBe(12)
  })

  it("a fixed Trim upstream: the window it passes on", () => {
    const g = videoGraph(secOf(60))
    const trim: N = { id: "trim", type: "trim-video", data: { mode: "first", seconds: 90 } }
    const edges = [
      ...g.edges.filter((e) => e.targetHandle !== "video"),
      { source: "rec", target: "trim", targetHandle: "in" },
      { source: "trim", target: "sv", targetHandle: "video" },
    ]
    const est = resolveApplyEdlEstimateMinutes(g.sv, [...g.nodes, trim], edges, ALL)
    expect(est).toBeGreaterThanOrEqual(1)
    expect(est).toBeLessThanOrEqual(60)
  })

  it("an Apply EDL is untouched by a stray `video` wire: no edit is still the floor", () => {
    const g = videoGraph(secOf(45))
    const ae: N = { id: "sv", type: "apply-edl", data: {} }
    expect(resolveApplyEdlEstimateMinutes(ae, [g.nodes[0]!, g.nodes[1]!, ae], g.edges, ALL)).toBe(1)
  })
})

describe("estimate ≥ reserve, for every layout, speaker count and quality", () => {
  const LAYOUTS = [undefined, "auto", "single", "side-by-side", "stacked", "grid", "pip"]
  const cases = LAYOUTS.flatMap((layout) =>
    SPEAKERS.flatMap((labels) =>
      (["final", "proxy"] as const).flatMap((quality) =>
        [undefined, "zoom"].map((switchType) => ({ layout, labels, quality, switchType })),
      ),
    ),
  )

  it.each(cases)("$layout · $labels.length speaker(s) · $quality · switch $switchType", ({ layout, labels, quality, switchType }) => {
    const view = { ...(layout ? { layout } : {}), quality, ...(switchType ? { switchType } : {}) }
    const minutes = 46
    const g = videoGraph(secOf(minutes), view)
    const run = reserve(view, labels, minutes)
    const estId = renderEstimateCreditId(g.sv, g.nodes, g.edges, ALL)
    const estMinutes = resolveApplyEdlEstimateMinutes(g.sv, g.nodes, g.edges, ALL)
    // Same quality row family, never a cheaper tier than the run's.
    expect(estId?.endsWith(":proxy") ?? false).toBe(run.id.endsWith(":proxy"))
    expect(rate(estId)).toBeGreaterThanOrEqual(SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[run.id])
    expect(rate(estId)! * estMinutes).toBeGreaterThanOrEqual(run.base)
  })
})

describe("the server's run estimate and a listing quote the clip, not one minute", () => {
  const minutes = 46
  const view = { layout: "single", quality: "final" }

  it("the run estimate's Speaker View line is the rate × the clip's minutes", () => {
    const g = videoGraph(secOf(minutes), view)
    const withView = CreditsService.estimateWorkflowBaseCredits(g.nodes, g.edges)
    const without = CreditsService.estimateWorkflowBaseCredits(g.nodes.slice(0, 2), g.edges.filter((e) => e.target !== "sv"))
    expect(withView - without).toBe(SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE["speaker-view"] * minutes)
    expect(withView - without).toBeGreaterThanOrEqual(reserve(view, ["Alex", "Sam"], minutes).base)
  })

  it("a listing whose recording the app's user replaces lists the render per minute of it", () => {
    const g = videoGraph(secOf(minutes), view)
    const replaced = { replaceableMediaNodeIds: new Set(["rec"]) }
    const withView = CreditsService.estimateWorkflowBaseListing(g.nodes, g.edges, "app", replaced)
    const without = CreditsService.estimateWorkflowBaseListing(g.nodes.slice(0, 2), g.edges.filter((e) => e.target !== "sv"), "app", replaced)
    const perMinute = withView.previewPerMinute - without.previewPerMinute
    expect(perMinute).toBe(SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE["speaker-view"])
    for (const m of [1, 7, 45, 180]) {
      const listed = withView.preview - without.preview + perMinute * m
      expect(listed, `${m} min`).toBeGreaterThanOrEqual(reserve(view, ["Alex", "Sam"], m).base)
    }
  })
})
