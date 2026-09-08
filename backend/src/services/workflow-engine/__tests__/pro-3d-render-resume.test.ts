import { describe, it, expect } from "vitest"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import type { SimpleNode } from "../types.js"

/**
 * Resume hydration for 3D Render Pro.
 *
 * The node settles ONE operation with TWO halves — an exported MP4 and the
 * scene revision it was rendered from — and the server-side resolver reads a
 * node that ran EARLIER from its saved `data`, not from a job row. Skip resume,
 * "Run from here" and `payload-builder`'s reference resolution all go through
 * `extractSavedNodeOutput` → `getPrimaryOutput`, so a half that is missing
 * there is a downstream consumer that silently receives nothing.
 */
function proNode(data: Record<string, unknown>): SimpleNode {
  return { id: "p1", type: "pro-3d-render", data }
}

const PLAN = { planType: "3d-scene", schemaVersion: 2, revisionId: "rev-1" }
const MP4 = "https://r2.example/renders/pro.mp4"

describe("extractSavedNodeOutput — pro-3d-render", () => {
  it("hydrates BOTH halves from a node that ran earlier", () => {
    expect(extractSavedNodeOutput(proNode({ scenePlan: PLAN, generatedVideoUrl: MP4 }))).toEqual({
      videoUrl: MP4,
      plan: PLAN,
    })
  })

  it("prefers the ACTIVE result over the last-written url, like every other video producer", () => {
    const saved = extractSavedNodeOutput(
      proNode({
        scenePlan: PLAN,
        generatedVideoUrl: "https://r2.example/renders/first.mp4",
        generatedResults: [
          { url: "https://r2.example/renders/first.mp4", timestamp: "t0", jobId: "j0" },
          { url: MP4, timestamp: "t1", jobId: "j1" },
        ],
        activeResultIndex: 1,
      }),
    )
    expect(saved?.videoUrl).toBe(MP4)
  })

  it("hydrates the scene alone when the node holds a composition but no render yet", () => {
    expect(extractSavedNodeOutput(proNode({ scenePlan: PLAN }))).toEqual({ plan: PLAN })
  })

  it("returns undefined for a node that has neither", () => {
    expect(extractSavedNodeOutput(proNode({ scenePrompt: "a lighthouse" }))).toBeUndefined()
  })
})

describe("getPrimaryOutput — a SAVED pro-3d-render routes per handle", () => {
  const saved = extractSavedNodeOutput(proNode({ scenePlan: PLAN, generatedVideoUrl: MP4 }))!

  it("gives a downstream VIDEO consumer the MP4, not a plan marker", () => {
    expect(getPrimaryOutput(saved, "pro-3d-render", "video")).toBe(MP4)
  })

  it("gives the composition handle the plan marker", () => {
    expect(getPrimaryOutput(saved, "pro-3d-render", "composition")).toBe("plan-ready")
    expect(getPrimaryOutput(saved, "pro-3d-render", undefined)).toBe("plan-ready")
  })

  it("resolves the video handle to nothing when only the scene was saved", () => {
    const planOnly = extractSavedNodeOutput(proNode({ scenePlan: PLAN }))!
    expect(getPrimaryOutput(planOnly, "pro-3d-render", "video")).toBeUndefined()
    expect(getPrimaryOutput(planOnly, "pro-3d-render", "composition")).toBe("plan-ready")
  })
})
