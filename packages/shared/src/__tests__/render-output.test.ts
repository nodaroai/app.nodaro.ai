import { describe, it, expect } from "vitest"
// Through the package index: both engines and SDK users read a saved render
// through these.
import {
  edlSpanKey,
  planClipKeyAt,
  renderClipKey,
  renderPlanClipKey,
  renderPlanNodeId,
  renderPlanPath,
  renderResultStamp,
  savedRenderBatch,
  savedRenderBatchUrls,
  savedRenderOutput,
} from "../index.js"

const take = (url: string, extra: Record<string, unknown> = {}) => ({ url, jobId: `job-${url}`, timestamp: "2026-10-05T00:00:00.000Z", ...extra })

describe("renderResultStamp — what a finished render says about itself", () => {
  it("keeps a known quality and a non-empty clip key", () => {
    expect(renderResultStamp({ videoUrl: "v", quality: "proxy", clipKey: "1000-9000" })).toEqual({ quality: "proxy", clipKey: "1000-9000" })
    expect(renderResultStamp({ quality: "final" })).toEqual({ quality: "final" })
  })

  it("drops anything that is not one of the two qualities, and an empty or non-string key", () => {
    expect(renderResultStamp({ quality: "PROXY", clipKey: "" })).toEqual({})
    expect(renderResultStamp({ quality: "high", clipKey: 12 })).toEqual({})
    expect(renderResultStamp(undefined)).toEqual({})
    expect(renderResultStamp(null)).toEqual({})
  })
})

describe("savedRenderOutput — the one result a saved render hands on", () => {
  it("is the active result, routed by the node's output", () => {
    const data = {
      output: "video",
      generatedResults: [take("new", { quality: "proxy" }), take("old", { quality: "final", thumbnailUrl: "t-old" })],
      activeResultIndex: 1,
      generatedVideoUrl: "old",
    }
    expect(savedRenderOutput(data)).toEqual({
      url: "old", medium: "video", jobId: "job-old", thumbnailUrl: "t-old", quality: "final",
    })
  })

  it("an audio render is an audio result", () => {
    const data = { output: "audio", generatedResults: [take("a1")], generatedAudioUrl: "a1" }
    expect(savedRenderOutput(data)).toMatchObject({ url: "a1", medium: "audio" })
  })

  it("repairs a pick saved before the results gallery wrote the right field: the picked take wins", () => {
    // The gallery wrote the picked take to generatedImageUrl and left
    // generatedVideoUrl on the newest one; activeResultIndex names the pick.
    const data = {
      generatedResults: [take("newest"), take("picked")],
      activeResultIndex: 1,
      generatedVideoUrl: "newest",
      generatedImageUrl: "picked",
    }
    expect(savedRenderOutput(data)?.url).toBe("picked")
  })

  it("falls back to the saved field of the node's medium, then the other one", () => {
    expect(savedRenderOutput({ generatedVideoUrl: "v" })).toEqual({ url: "v", medium: "video" })
    expect(savedRenderOutput({ output: "audio", generatedAudioUrl: "a", generatedVideoUrl: "v" })).toEqual({ url: "a", medium: "audio" })
    expect(savedRenderOutput({ output: "audio", generatedVideoUrl: "v" })).toEqual({ url: "v", medium: "video" })
    expect(savedRenderOutput({ generatedAudioUrl: "a" })).toEqual({ url: "a", medium: "audio" })
  })

  it("an out-of-range index reads the first result, and nothing saved is undefined", () => {
    expect(savedRenderOutput({ generatedResults: [take("only")], activeResultIndex: 7 })?.url).toBe("only")
    expect(savedRenderOutput({})).toBeUndefined()
    expect(savedRenderOutput({ generatedResults: [] })).toBeUndefined()
  })
})

describe("savedRenderBatch — the LATEST batch a saved render hands an each edge (TA6)", () => {
  // History: a preview batch (the newest run) on top of a final batch, with the
  // active result toggled back to a final take.
  const data = {
    output: "video",
    generatedResults: [
      take("p0", { quality: "proxy", clipKey: "0-1000" }),
      take("p2", { quality: "proxy", clipKey: "4000-5000" }),
      take("f0", { quality: "final", clipKey: "0-1000" }),
      take("f1", { quality: "final", clipKey: "2000-3000" }),
      take("f2", { quality: "final", clipKey: "4000-5000" }),
    ],
    activeResultIndex: 3,
    __listResults: ["p0", "", "p2"],
  }

  it("is the last batch, row-aligned (a failed row stays a hole), never the history", () => {
    expect(savedRenderBatch(data)).toEqual([
      { url: "p0", medium: "video", jobId: "job-p0", quality: "proxy", clipKey: "0-1000" },
      null,
      { url: "p2", medium: "video", jobId: "job-p2", quality: "proxy", clipKey: "4000-5000" },
    ])
    expect(savedRenderBatchUrls(data)).toEqual(["p0", "", "p2"])
  })

  it("does not follow the toggled active result — that is the scalar's", () => {
    expect(savedRenderOutput(data)?.url).toBe("f1")
  })

  it("a render that ran once has no batch (an each edge then reads the one result)", () => {
    expect(savedRenderBatch({ generatedResults: [take("a"), take("b")] })).toBeUndefined()
    expect(savedRenderBatch({ __listResults: [] })).toBeUndefined()
    expect(savedRenderBatchUrls({ __listResults: ["", ""] })).toEqual(["", ""])
  })

  it("a batch URL with no result entry still lists, with nothing stamped", () => {
    expect(savedRenderBatch({ output: "audio", __listResults: ["x"] })).toEqual([{ url: "x", medium: "audio" }])
  })
})

describe("edlSpanKey / planClipKeyAt — a plan clip's identity", () => {
  const clip = (segments: Array<[number, number]>) => ({
    version: 1, clock: "master", sources: [{ id: "s", url: "u", kind: "video" }],
    segments: segments.map(([inMs, outMs], i) => ({ id: `seg-${i}`, inMs, outMs, video: "s" })),
  })

  it("is the outer span of the clip's kept segments on the master clock", () => {
    expect(edlSpanKey(clip([[5000, 9000], [1200, 3000], [12000, 15000.4]]))).toBe("1200-15000")
  })

  it("is undefined for something that is not an EDL with segments", () => {
    expect(edlSpanKey(clip([]))).toBeUndefined()
    expect(edlSpanKey("nope")).toBeUndefined()
    expect(edlSpanKey(null)).toBeUndefined()
  })

  it("reads a clips plan's row (objects or JSON strings), and nothing for a single-EDL plan", () => {
    const plan = [clip([[0, 1000]]), JSON.stringify(clip([[2000, 3000]]))]
    expect(planClipKeyAt(plan, 0)).toBe("0-1000")
    expect(planClipKeyAt(plan, 1)).toBe("2000-3000")
    expect(planClipKeyAt(plan, 2)).toBeUndefined()
    expect(planClipKeyAt(clip([[0, 1000]]), 0)).toBeUndefined()
    expect(planClipKeyAt(["", "{bad"], 1)).toBeUndefined()
  })
})

describe("renderPlanNodeId / renderClipKey — the plan clip a render iteration reads", () => {
  const nodes = [
    { id: "plan", type: "edit-plan" },
    { id: "tp-send", type: "teleport-send" },
    { id: "tp-recv", type: "teleport-receive" },
    { id: "switch", type: "camera-switch" },
    { id: "render", type: "apply-edl" },
    { id: "other", type: "text-prompt" },
  ]

  it("walks the render's edl wire up through teleports and Camera Switch to the plan", () => {
    const edges = [
      { source: "plan", target: "tp-send", targetHandle: "in" },
      { source: "tp-send", target: "tp-recv" },
      { source: "tp-recv", target: "switch", targetHandle: "edl" },
      { source: "other", target: "switch", targetHandle: "transcript" },
      { source: "switch", target: "render", targetHandle: "edl" },
    ]
    expect(renderPlanNodeId("render", nodes, edges)).toBe("plan")
  })

  it("reads the LAST wire on the edl handle (both engines keep the last value)", () => {
    const edges = [
      { source: "other", target: "render", targetHandle: "edl" },
      { source: "plan", target: "render", targetHandle: "edl" },
    ]
    expect(renderPlanNodeId("render", nodes, edges)).toBe("plan")
    expect(renderPlanNodeId("render", nodes, [...edges].reverse())).toBeUndefined()
  })

  it("no plan upstream, or a loop, is undefined", () => {
    expect(renderPlanNodeId("render", nodes, [])).toBeUndefined()
    expect(renderPlanNodeId("render", nodes, [
      { source: "tp-recv", target: "render", targetHandle: "edl" },
      { source: "tp-send", target: "tp-recv" },
      { source: "tp-recv", target: "tp-send" },
    ])).toBeUndefined()
  })

  it("an iteration reads its row; a run of no row reads a one-clip plan's clip, and nothing of a larger one", () => {
    const one = { version: 1, clock: "master", sources: [], segments: [{ id: "a", inMs: 10, outMs: 20 }] }
    const two = { ...one, segments: [{ id: "b", inMs: 30, outMs: 40 }] }
    expect(renderClipKey([one, two], 1)).toBe("30-40")
    expect(renderClipKey([one], undefined)).toBe("10-20")
    expect(renderClipKey([one, two], undefined)).toBeUndefined()
    expect(renderClipKey(one, undefined)).toBeUndefined()
    expect(renderClipKey(undefined, 0)).toBeUndefined()
  })
})

describe("renderPlanClipKey — the clip a row reads is picked by every selector on the way", () => {
  const span = (inMs: number, outMs: number) =>
    JSON.stringify({ version: 1, clock: "master", sources: [], segments: [{ id: `s${inMs}`, inMs, outMs }] })
  const PLAN = [span(0, 1000), span(2000, 3000), span(4000, 5000), span(6000, 7000)]
  const nodes = [
    { id: "plan", type: "edit-plan" },
    { id: "tp-send", type: "teleport-send" },
    { id: "tp-recv", type: "teleport-receive" },
    { id: "switch", type: "camera-switch" },
    { id: "render", type: "apply-edl" },
  ]
  const planList = () => PLAN
  const pick = (listExpression: string) => ({ selectorMode: "list" as const, listExpression })

  it("a selector on the render's edl wire: row k is row k of the SELECTED clips, not of the plan", () => {
    const edges = [{ source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl", data: pick("3,4") }]
    expect(renderPlanClipKey("render", nodes, edges, planList, 0)).toBe("4000-5000")
    expect(renderPlanClipKey("render", nodes, edges, planList, 1)).toBe("6000-7000")
  })

  it("a selector on the plan to Camera Switch wire: Camera Switch's row k is row k of ITS selected clips", () => {
    const edges = [
      { source: "plan", sourceHandle: "edl", target: "switch", targetHandle: "edl", data: { rangeFrom: "2", rangeTo: "last", rangeStep: 2 } },
      { source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl" },
    ]
    expect(renderPlanClipKey("render", nodes, edges, planList, 0)).toBe("2000-3000")
    expect(renderPlanClipKey("render", nodes, edges, planList, 1)).toBe("6000-7000")
  })

  it("both selectors compose, plan down to the render, and a teleport hands the consumer wire's selector on", () => {
    const edges = [
      { source: "plan", sourceHandle: "edl", target: "tp-send", targetHandle: "in" },
      { source: "tp-send", target: "tp-recv" },
      { source: "tp-recv", target: "switch", targetHandle: "edl", data: pick("2,3,4") },
      { source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl", data: pick("2") },
    ]
    expect(renderPlanPath("render", nodes, edges)?.planId).toBe("plan")
    expect(renderPlanClipKey("render", nodes, edges, planList, 0)).toBe("4000-5000")
  })

  it("a row past the clips starts over from the first, as both input resolvers read it", () => {
    const one = [span(10, 20)]
    const edges = [{ source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" }]
    expect(renderPlanClipKey("render", nodes, edges, () => one, 3)).toBe("10-20")
    expect(renderClipKey(one, 2)).toBe("10-20")
  })

  // A wire that hands on ONE value names the clip that value is, as both input
  // resolvers pick it (decided 2026-10-05). "last" is the UI's "Selected": the
  // plan's own output, its FIRST clip — not the last clip of the list.
  const wire = (data: Record<string, unknown>) => [{ source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl", data }]

  it("a Selected (\"last\") wire from an Edit Plan names the plan's own output, its first clip", () => {
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "last" }), planList, undefined)).toBe("0-1000")
    // A row another list drives does not index a wire that hands on one value.
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "last" }), planList, 1)).toBe("0-1000")
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "last" }), () => [PLAN[2]], 1)).toBe("4000-5000")
  })

  it("an item wire names the clip at its index; its range / list selector does not apply", () => {
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "item", itemIndex: "2" }), planList, undefined)).toBe("2000-3000")
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "item", itemIndex: "last" }), planList, undefined)).toBe("6000-7000")
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "item", itemIndex: "9" }), planList, undefined)).toBe("6000-7000")
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "item", itemIndex: "1", ...pick("3,4") }), planList, undefined)).toBe("0-1000")
    // Legacy item:N — 0-based, past the end reads the first.
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "item:1" }), planList, undefined)).toBe("2000-3000")
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "item:9" }), planList, undefined)).toBe("0-1000")
  })

  it("an all wire names a clip only when its selector leaves exactly one", () => {
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "all", ...pick("3") }), planList, undefined)).toBe("4000-5000")
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "all", ...pick("3,4") }), planList, undefined)).toBeUndefined()
    expect(renderPlanClipKey("render", nodes, wire({ outputMode: "all" }), planList, undefined)).toBeUndefined()
  })

  it("a teleport hands the consumer wire's single pick on", () => {
    const edges = [
      { source: "plan", sourceHandle: "edl", target: "tp-send", targetHandle: "in" },
      { source: "tp-send", target: "tp-recv" },
      { source: "tp-recv", target: "render", targetHandle: "edl", data: { outputMode: "item", itemIndex: "3" } },
    ]
    expect(renderPlanClipKey("render", nodes, edges, planList, undefined)).toBe("4000-5000")
  })

  it("a single pick into Camera Switch names that clip on the render after it", () => {
    const edges = [
      { source: "plan", sourceHandle: "edl", target: "switch", targetHandle: "edl", data: { outputMode: "item", itemIndex: "4" } },
      { source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl" },
    ]
    expect(renderPlanClipKey("render", nodes, edges, planList, undefined)).toBe("6000-7000")
  })

  it("a Selected wire out of a Camera Switch that ran per clip names no clip (the engines keep different clips)", () => {
    const edges = [
      { source: "plan", sourceHandle: "edl", target: "switch", targetHandle: "edl" },
      { source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl", data: { outputMode: "last" } },
    ]
    expect(renderPlanClipKey("render", nodes, edges, planList, undefined)).toBeUndefined()
    expect(renderPlanClipKey("render", nodes, edges, () => [PLAN[1]], undefined)).toBe("2000-3000")
  })

  it("no plan behind the edl wire stamps nothing", () => {
    expect(renderPlanClipKey("render", nodes, [], planList, 0)).toBeUndefined()
  })
})
