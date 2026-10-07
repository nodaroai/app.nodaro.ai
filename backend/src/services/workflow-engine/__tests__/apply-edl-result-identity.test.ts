/**
 * An Apply EDL render's identity on the server (A1b).
 *
 *   - The payload carries `clipKey`: the plan clip's `edlSpanKey`, taken from
 *     the Edit Plan row the iteration reads — never from the rendered EDL
 *     (Camera Switch can shrink a clip's outer span).
 *   - A finished job's `quality` and `clipKey` reach the node's output, and a
 *     fan-out keeps every row's {jobId, thumbnailUrl, quality, clipKey}
 *     row-aligned with its results, holes included.
 */
import { describe, it, expect } from "vitest"
import type { Edl } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import { buildNodeOutputFromJobData } from "../output-extractor.js"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"
import { seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const clip = (inMs: number, outMs: number): Edl => ({
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/a.mp4", kind: "video" }],
  segments: [
    { id: "seg-0", inMs, outMs: inMs + 1000, video: "A" },
    { id: "seg-1", inMs: outMs - 1000, outMs, video: "A" },
  ],
})

const PLAN = [clip(0, 10_000), clip(20_000, 30_000), clip(40_000, 50_000)]

const plan: SimpleNode = { id: "plan", type: "edit-plan", data: { mode: "clips", generatedJson: PLAN } }
const sw: SimpleNode = { id: "switch", type: "camera-switch", data: {} }
const render: SimpleNode = { id: "render", type: "apply-edl", data: { output: "video", quality: "proxy" } }

describe("the payload's clipKey — from the plan row the iteration reads", () => {
  it("row 1 of a clips plan behind Camera Switch stamps the PLAN clip's span, not the switched EDL's", () => {
    const edges: SimpleEdge[] = [
      { id: "e1", source: "plan", sourceHandle: "edl", target: "switch", targetHandle: "edl" },
      { id: "e2", source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl" },
    ]
    // Camera Switch dropped a no-picture start: its EDL starts later than the plan clip.
    const switched = { ...PLAN[1], segments: [{ id: "seg-1", inMs: 29_000, outMs: 30_000, video: "A" }] }
    const nodeStates: Record<string, NodeExecutionState> = { plan: seededFromSavedData({ json: PLAN }) }
    const result = buildPayload(render, "job-1", { edl: JSON.stringify(switched) }, "ul", {
      nodes: [plan, sw, render], edges, nodeStates, listRow: 1,
    })
    expect(result.payload.clipKey).toBe("20000-30000")
    expect(result.payload.quality).toBe("proxy")
  })

  it("a render of a Tighten plan (one EDL), or of no plan, stamps no clip", () => {
    const tighten: SimpleNode = { id: "plan", type: "edit-plan", data: { mode: "tighten", generatedJson: PLAN[0] } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" }]
    const withTighten = buildPayload(render, "job-1", { edl: JSON.stringify(PLAN[0]) }, "ul", {
      nodes: [tighten, render], edges, nodeStates: { plan: seededFromSavedData({ json: PLAN[0] }) },
    })
    expect(withTighten.payload.clipKey).toBeUndefined()
    const inline = buildPayload(render, "job-1", { edl: JSON.stringify(PLAN[0]) }, "ul")
    expect(inline.payload.clipKey).toBeUndefined()
  })
})

describe("a finished render's stamps reach the node output", () => {
  it("apply-edl keeps quality, clipKey and the thumbnail", () => {
    const out = buildNodeOutputFromJobData(
      { videoUrl: "v.mp4", thumbnailUrl: "t.jpg", quality: "proxy", clipKey: "0-10000" },
      "apply-edl",
    )
    expect(out).toMatchObject({ videoUrl: "v.mp4", thumbnailUrl: "t.jpg", quality: "proxy", clipKey: "0-10000" })
  })

  it("another node's output_data quality is never read as a render quality", () => {
    const out = buildNodeOutputFromJobData({ imageUrl: "i.png", quality: "proxy" }, "generate-image")
    expect(out.quality).toBeUndefined()
  })
})

describe("a fan-out keeps each row's identity, row-aligned (the server lane's job-id pairing)", () => {
  const ok = (index: number, jobId: string, videoUrl: string, extra: Record<string, unknown> = {}): PromiseSettledResult<FanOutIterationValue> => ({
    status: "fulfilled",
    value: { index, resultValue: videoUrl, result: { jobId, output: { videoUrl, ...extra } } },
  })
  const failed: PromiseSettledResult<FanOutIterationValue> = { status: "rejected", reason: new Error("boom") }

  it("rows finish out of order and one fails: each row keeps its own job", () => {
    const settled = [
      ok(2, "job-c", "c.mp4", { thumbnailUrl: "c.jpg", quality: "proxy", clipKey: "40000-50000" }),
      failed,
      ok(0, "job-a", "a.mp4", { thumbnailUrl: "a.jpg", quality: "proxy", clipKey: "0-10000" }),
    ]
    const { output } = assembleFanOutResult(settled, 3)
    expect(output.listResults).toEqual(["a.mp4", "", "c.mp4"])
    expect(output.listResultStamps).toEqual([
      { jobId: "job-a", thumbnailUrl: "a.jpg", quality: "proxy", clipKey: "0-10000" },
      {},
      { jobId: "job-c", thumbnailUrl: "c.jpg", quality: "proxy", clipKey: "40000-50000" },
    ])
  })
})
