/**
 * The canvas half of "3D Render Pro emits one still per shot".
 *
 * Three properties, because each has its own way of silently failing: the
 * stills must SETTLE onto the result the video settled onto, the `stills`
 * handle must resolve to a real image URL (not the plan marker every other
 * non-video handle of this node resolves to), and the canvas must accept the
 * wire the handle exists for.
 */
import { describe, expect, it } from "vitest"
import { proMediaCompletionPatch, proShotStills } from "../scene3d/pro-media-result"
import { isValidWorkflowConnection } from "../connection-validation"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
import { IMAGE_PRODUCER_TYPES } from "../generate-image-handles"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import type { WorkflowNode } from "@/types/nodes"

const stills = [
  { shotIndex: 1, frame: 48, assetId: "b", url: "https://cdn.example/b.png" },
  { shotIndex: 0, frame: 0, assetId: "a", url: "https://cdn.example/a.png" },
]
const timestamp = "2026-09-10T20:00:00.000Z"
const types = (map: Record<string, string>) => (id: string) => map[id]

describe("stills settle with the video they were rendered beside", () => {
  it("attaches them to the settling result, in shot order", () => {
    const patch = proMediaCompletionPatch(
      { videoUrl: "render.mp4", shotStills: stills },
      { jobId: "job", liveNode: {} },
      timestamp,
    )
    expect(patch.generatedResults).toEqual([{
      url: "render.mp4", jobId: "job", timestamp,
      shotStills: [
        { shotIndex: 0, frame: 0, assetId: "a", url: "https://cdn.example/a.png" },
        { shotIndex: 1, frame: 48, assetId: "b", url: "https://cdn.example/b.png" },
      ],
    }])
  })

  it("leaves a result that has none without the key at all", () => {
    const patch = proMediaCompletionPatch({ videoUrl: "render.mp4" }, { jobId: "job", liveNode: {} }, timestamp)
    expect((patch.generatedResults as Array<Record<string, unknown>>)[0]).not.toHaveProperty("shotStills")
  })

  it("reads the ACTIVE result's stills, so switching results switches the sheet", () => {
    const data = {
      activeResultIndex: 1,
      generatedResults: [
        { url: "a.mp4", jobId: "a", timestamp, shotStills: [stills[0]] },
        { url: "b.mp4", jobId: "b", timestamp, shotStills: stills },
      ],
    }
    expect(proShotStills(data).map((still) => still.assetId)).toEqual(["a", "b"])
    expect(proShotStills({ ...data, activeResultIndex: 0 }).map((still) => still.assetId)).toEqual(["b"])
    expect(proShotStills({ ...data, activeResultIndex: 0 })[0].shotIndex).toBe(1)
    expect(proShotStills({})).toEqual([])
  })
})

describe("the stills handle", () => {
  const node = (data: Record<string, unknown>) =>
    ({ id: "pro", type: "pro-3d-render", position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode

  it("resolves to the first still, never the plan marker", () => {
    const withStills = node({ scenePlan: { revisionId: "r" }, activeResultIndex: 0,
      generatedResults: [{ url: "v.mp4", jobId: "j", timestamp, shotStills: stills }] })
    expect(extractNodeOutput(withStills, "stills")).toBe("https://cdn.example/a.png")
    // The node's other handles are untouched by the new one.
    expect(extractNodeOutput(withStills, "video")).toBe("v.mp4")
    expect(extractNodeOutput(withStills, "composition")).toBe("plan-ready")
  })

  it("resolves to nothing when this result rendered none", () => {
    expect(extractNodeOutput(node({ scenePlan: { revisionId: "r" } }), "stills")).toBeUndefined()
  })

  it("is registered as an image output, so its wire reads as an image wire", () => {
    expect(HANDLE_OUTPUT_TYPES["pro-3d-render"].stills).toBe("image")
    expect(IMAGE_PRODUCER_TYPES.has("pro-3d-render")).toBe(true)
  })

  it("may be wired into an image consumer, and does not become a composition wire", () => {
    expect(isValidWorkflowConnection(
      { source: "pro", target: "img", sourceHandle: "stills", targetHandle: "references" },
      types({ pro: "pro-3d-render", img: "generate-image" }),
    )).toBe(true)
    // The `composition` source rule still binds its own handle only.
    expect(isValidWorkflowConnection(
      { source: "pro", target: "img", sourceHandle: "composition", targetHandle: "references" },
      types({ pro: "pro-3d-render", img: "generate-image" }),
    )).toBe(false)
  })
})
