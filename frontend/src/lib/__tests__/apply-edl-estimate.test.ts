import { describe, it, expect } from "vitest"
import { persistedEdlPlan, resolveApplyEdlEstimateMinutes } from "../apply-edl-estimate"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const edge = (source: string, target: string, targetHandle: string | null) => ({ source, target, targetHandle })
const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
const edlOf = (...segments: Array<Record<string, unknown>>) => ({
  version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments,
})

const NONE: ReadonlySet<string> = new Set()
const reruns = (...ids: string[]): ReadonlySet<string> => new Set(ids)

describe("an INLINE EDL (nothing wired) is exactly what renders", () => {
  const minutes = (edl: unknown) => {
    const ae = node("ae", "apply-edl", { edl })
    return resolveApplyEdlEstimateMinutes(ae, [ae], [], NONE)
  }

  it("prices its own length, rounded UP to whole minutes like the reserve", () => {
    expect(minutes(edlOf(seg(0, 61_000)))).toBe(2)
    expect(minutes(edlOf(seg(0, 600_000), seg(900_000, 1_500_000)))).toBe(20)
  })

  // Both engines, the route and the MCP verb accept a JSON STRING and render it in
  // full; the estimate used to read a string as "no EDL" and quote one minute.
  it("parses a stringified EDL like every server ingress does", () => {
    expect(minutes(JSON.stringify(edlOf(seg(0, 45 * 60_000))))).toBe(45)
  })

  // The server reserves on normalizeEdl(edl), which COERCES — it can lengthen a
  // sloppy EDL. Measuring the raw object quoted less than the reserve.
  it("measures the normalized EDL, not the raw one", () => {
    // `inMs` missing → normalizeEdl coerces it to 0 → a 10-minute segment.
    expect(minutes(edlOf({ id: "a", outMs: 600_000, video: "v" }))).toBe(10)
    // A numeric STRING is coerced to 0 by normalizeEdl (JS arithmetic would read 30).
    expect(minutes(edlOf({ id: "a", inMs: "1800000", outMs: 3_600_000, video: "v" }))).toBe(60)
  })

  it("floors at one minute when there is no EDL to render at all", () => {
    expect(minutes(undefined)).toBe(1)
    expect(minutes("")).toBe(1)
    expect(minutes("{not json")).toBe(1)
    expect(minutes({ segments: [] })).toBe(1)
    expect(minutes(edlOf(seg(0, 4_000)))).toBe(1)
  })
})

describe("wired from Edit Plan (tighten)", () => {
  const graph = (masterData: Record<string, unknown>, planData: Record<string, unknown> = {}) => {
    const master = node("m", "upload-audio", masterData)
    const plan = node("ep", "edit-plan", { mode: "tighten", ...planData })
    const ae = node("ae", "apply-edl", {})
    return { ae, nodes: [master, plan, ae], edges: [edge("m", "ep", "sources"), edge("ep", "ae", "edl")] }
  }
  const lastWeeks = edlOf(seg(0, 12 * 60_000))

  describe("the planner RE-RUNS (whole-workflow run): the canvas plan is stale", () => {
    it("prices the episode's own length", () => {
      const g = graph({ metadata: { durationSeconds: 45 * 60 } })
      expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ep", "ae"))).toBe(45)
    })

    // THE regression: reusing the workflow for a longer episode must not price
    // last week's 12-minute cut.
    it("ignores the persisted plan from the previous run", () => {
      const g = graph({ metadata: { durationSeconds: 100 * 60 } }, { generatedJson: lastWeeks })
      expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ep", "ae"))).toBe(100)
    })

    it("an unknown master length prices the ceiling; a huge one caps at it", () => {
      const unknown = graph({ audioUrl: "https://host/direct.mp3" })
      expect(resolveApplyEdlEstimateMinutes(unknown.ae, unknown.nodes, unknown.edges, reruns("ep"))).toBe(180)
      const huge = graph({ metadata: { durationSeconds: 300 * 60 } })
      expect(resolveApplyEdlEstimateMinutes(huge.ae, huge.nodes, huge.edges, reruns("ep"))).toBe(180)
    })

    // The planner spans max(transcript end, master): a transcript made from
    // DIFFERENT, longer media than the master plans past the master.
    it("prices the longer of the master and the transcribed media", () => {
      const master = node("m", "upload-audio", { metadata: { durationSeconds: 30 * 60 } })
      const camera = node("cam", "upload-video", { metadata: { durationSeconds: 50 * 60 } })
      const tr = node("tr", "transcribe")
      const plan = node("ep", "edit-plan", { mode: "tighten" })
      const ae = node("ae", "apply-edl", {})
      const edges = [edge("m", "ep", "sources"), edge("cam", "tr", "audio"), edge("tr", "ep", "transcript"), edge("ep", "ae", "edl")]
      expect(resolveApplyEdlEstimateMinutes(ae, [master, camera, tr, plan, ae], edges, reruns("tr", "ep", "ae"))).toBe(50)
    })
  })

  describe("the planner does NOT re-run (single-node Run, the node's pill): the plan on the canvas IS what renders", () => {
    it("prices that plan exactly — not the hour-long master", () => {
      const g = graph({ metadata: { durationSeconds: 100 * 60 } }, { generatedJson: lastWeeks })
      expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, NONE)).toBe(12)
      // …also when only the render is in the executable set (run-from-here).
      expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ae"))).toBe(12)
    })
    it("falls back to the episode estimate when there is no plan yet", () => {
      const g = graph({ metadata: { durationSeconds: 45 * 60 } })
      expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, NONE)).toBe(45)
    })
  })

  it("reads the producer through a teleport pair", () => {
    const master = node("m", "upload-audio", { metadata: { durationSeconds: 30 * 60 } })
    const plan = node("ep", "edit-plan", { mode: "tighten" })
    const send = node("ts", "teleport-send"), recv = node("tr", "teleport-receive")
    const ae = node("ae", "apply-edl", {})
    const edges = [edge("m", "ep", "sources"), edge("ep", "ts", "in"), edge("ts", "tr", null), edge("tr", "ae", "edl")]
    expect(resolveApplyEdlEstimateMinutes(ae, [master, plan, send, recv, ae], edges, reruns("ep", "ae"))).toBe(30)
  })
})

describe("wired from Edit Plan (clips): ONE clip — the fan-out multiplier counts them", () => {
  const clips = (planData: Record<string, unknown>, masterSec = 60 * 60) => {
    const master = node("m", "upload-audio", { metadata: { durationSeconds: masterSec } })
    const plan = node("ep", "edit-plan", { mode: "clips", ...planData })
    const ae = node("ae", "apply-edl", {})
    return { ae, nodes: [master, plan, ae], edges: [edge("m", "ep", "sources"), edge("ep", "ae", "edl")] }
  }
  it("re-planning: twice the clip-length target (it is a target, not a clamp)", () => {
    const g = clips({ targetDurationSec: 60 })
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ep"))).toBe(2)
  })
  it("re-planning with no target: an assumed 90 s clip", () => {
    const g = clips({})
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ep"))).toBe(3)
  })
  it("a clip is never priced longer than the episode it is cut from", () => {
    const g = clips({ targetDurationSec: 180 }, 90) // a 90-second master
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ep"))).toBe(2)
  })
  it("NOT re-planning: the LONGEST persisted clip, exactly", () => {
    const g = clips({ targetDurationSec: 30, generatedJson: [edlOf(seg(0, 40_000)), edlOf(seg(0, 5 * 60_000)), edlOf(seg(0, 70_000))] })
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, NONE)).toBe(5)
  })
})

describe("any other producer", () => {
  const jp = (data: Record<string, unknown>) => node("jp", "json-process", data)
  const ae = node("ae", "apply-edl", {})
  const edges = [edge("jp", "ae", "edl")]

  it("re-running with an unknowable result prices the ceiling", () => {
    expect(resolveApplyEdlEstimateMinutes(ae, [jp({}), ae], edges, reruns("jp", "ae"))).toBe(180)
  })
  // The single-node Run button used to be blocked at the 1,800-credit ceiling for
  // a five-minute EDL that was sitting right there on the producer.
  it("NOT re-running: its persisted EDL is what renders — priced exactly", () => {
    expect(resolveApplyEdlEstimateMinutes(ae, [jp({ generatedJson: edlOf(seg(0, 5 * 60_000)) }), ae], edges, NONE)).toBe(5)
  })
})

// Both engines keep the LAST wired `edl` value and nothing stops a second wire
// landing on the handle — reading only the first edge could price the cheaper one.
it("with several wires on `edl`, prices the costliest", () => {
  const short = node("a", "json-process", { generatedJson: edlOf(seg(0, 2 * 60_000)) })
  const long = node("b", "json-process", { generatedJson: edlOf(seg(0, 30 * 60_000)) })
  const ae = node("ae", "apply-edl", {})
  expect(resolveApplyEdlEstimateMinutes(ae, [short, long, ae], [edge("a", "ae", "edl"), edge("b", "ae", "edl")], NONE)).toBe(30)
  expect(resolveApplyEdlEstimateMinutes(ae, [short, long, ae], [edge("b", "ae", "edl"), edge("a", "ae", "edl")], NONE)).toBe(30)
})

// Camera Switch re-cuts an edit by camera and never changes its length, and it
// holds { edl, transcript } — read through it, never price the 180-min ceiling.
describe("wired through Camera Switch (B5)", () => {
  const graph = (csData: Record<string, unknown>, planData: Record<string, unknown> = {}) => {
    const master = node("m", "upload-audio", { metadata: { durationSeconds: 45 * 60 } })
    const plan = node("ep", "edit-plan", { mode: "tighten", ...planData })
    const cs = node("cs", "camera-switch", csData)
    const ae = node("ae", "apply-edl", {})
    return {
      ae,
      nodes: [master, plan, cs, ae],
      edges: [edge("m", "ep", "sources"), edge("ep", "cs", "edl"), edge("cs", "ae", "edl")],
    }
  }

  it("not re-running: the switched edit it holds is exactly what renders", () => {
    const g = graph({ generatedJson: { edl: edlOf(seg(0, 3 * 60_000)), transcript: { version: 1, words: [] } } })
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, NONE)).toBe(3)
  })

  it("a fanned-out run holds one pair per clip: the longest prices", () => {
    const pair = (ms: number) => ({ edl: edlOf(seg(0, ms)), transcript: { version: 1, words: [] } })
    const g = graph({ generatedJson: [pair(60_000), pair(150_000)] })
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, NONE)).toBe(3)
  })

  it("re-running: reads through to the Edit Plan that feeds it (the episode's length)", () => {
    const g = graph({ generatedJson: { edl: edlOf(seg(0, 60_000)), transcript: { version: 1, words: [] } } })
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("ep", "cs", "ae"))).toBe(45)
  })

  it("re-running with nothing on its EDL input: the ceiling", () => {
    const g = graph({})
    g.edges = g.edges.filter((e) => e.target !== "cs")
    expect(resolveApplyEdlEstimateMinutes(g.ae, g.nodes, g.edges, reruns("cs", "ae"))).toBe(180)
  })
})

describe("Camera Switch run once per clip (B5): the batch prices, not the last clip to finish", () => {
  it("reads __listResults — the longest clip — when the switch holds a batch", () => {
    const master = node("m", "upload-audio", { metadata: { durationSeconds: 45 * 60 } })
    const plan = node("ep", "edit-plan", { mode: "clips" })
    // The 2-minute clip finished last, so generatedJson holds it; the batch has a 10-minute one.
    const cs = node("cs", "camera-switch", {
      generatedJson: { edl: edlOf(seg(0, 2 * 60_000)), transcript: { version: 1, words: [] } },
      __listResults: [JSON.stringify(edlOf(seg(0, 10 * 60_000))), JSON.stringify(edlOf(seg(0, 2 * 60_000))), ""],
    })
    const ae = node("ae", "apply-edl", {})
    const edges = [edge("m", "ep", "sources"), edge("ep", "cs", "edl"), edge("cs", "ae", "edl")]
    expect(resolveApplyEdlEstimateMinutes(ae, [master, plan, cs, ae], edges, NONE)).toBe(10)
  })
})

// The Apply EDL panel badge reads a producer's plan through the same reader the
// estimate prices (`persistedEdlPlan`), from inside a store selector.
describe("persistedEdlPlan, the one reader of a held plan", () => {
  const planA = edlOf(seg(0, 60_000))
  const planB = edlOf(seg(0, 120_000))

  it("the same held array always reads as the same array (a stable store selector)", () => {
    const held = [{ edl: planA, transcript: {} }, { edl: planB, transcript: {} }]
    const cs = node("cs", "camera-switch", { generatedJson: held })
    const first = persistedEdlPlan(cs)
    expect(first).toEqual([planA, planB])
    expect(persistedEdlPlan(cs)).toBe(first)
  })

  it("Camera Switch: its switched EDL, or the whole per-clip batch; an Edit Plan: its plan as held", () => {
    expect(persistedEdlPlan(node("cs", "camera-switch", { generatedJson: { edl: planA, transcript: {} } }))).toBe(planA)
    const batch = [JSON.stringify(planA), "", JSON.stringify(planB)]
    expect(persistedEdlPlan(node("cs", "camera-switch", { generatedJson: { edl: planB, transcript: {} }, __listResults: batch }))).toBe(batch)
    const clips = [planA, planB]
    expect(persistedEdlPlan(node("p", "edit-plan", { generatedJson: clips }))).toBe(clips)
  })
})

