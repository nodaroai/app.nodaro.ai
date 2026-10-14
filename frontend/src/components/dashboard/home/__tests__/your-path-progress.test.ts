// @vitest-environment node
import { describe, it, expect } from "vitest"
import { computePathProgress, derivePathSignals } from "../your-path-progress"

const ownFlow = (nodeTypes: readonly string[] | null) => ({ nodeTypes, isDemoSeed: false })
const liveApp = { isActive: true, deletedAt: null, publishType: "app" as const }

describe("derivePathSignals", () => {
  it("reads nothing as done while the sources are still loading", () => {
    expect(derivePathSignals({})).toEqual({
      hasGeneratedImage: false,
      hasMultiNodeWorkflow: false,
      hasPublishedApp: false,
    })
  })

  it("counts an image as generated only once the stats report a positive image timing", () => {
    // get_stats COALESCEs the average to 0 when no image job has finished — so
    // 0 means "none yet", not a very fast image (migration 021).
    expect(derivePathSignals({ stats: { avgImageTime: 4.2 } }).hasGeneratedImage).toBe(true)
    expect(derivePathSignals({ stats: { avgImageTime: 0 } }).hasGeneratedImage).toBe(false)
    expect(derivePathSignals({ stats: { avgImageTime: null } }).hasGeneratedImage).toBe(false)
  })

  it("needs a workflow with at least two node types to count the workflow step", () => {
    expect(derivePathSignals({ workflows: [ownFlow(["generate-image"])] }).hasMultiNodeWorkflow).toBe(false)
    expect(
      derivePathSignals({ workflows: [ownFlow(null), ownFlow(["text", "generate-image"])] }).hasMultiNodeWorkflow,
    ).toBe(true)
  })

  it("does not count the seeded Welcome Demo as a workflow the user built", () => {
    expect(
      derivePathSignals({ workflows: [{ nodeTypes: ["text", "generate-image", "image-to-video"], isDemoSeed: true }] })
        .hasMultiNodeWorkflow,
    ).toBe(false)
  })

  it("counts only a live, published MiniApp", () => {
    expect(derivePathSignals({ apps: [{ ...liveApp, isActive: false }] }).hasPublishedApp).toBe(false)
    expect(derivePathSignals({ apps: [{ ...liveApp, deletedAt: "2026-09-01T00:00:00Z" }] }).hasPublishedApp).toBe(false)
    expect(derivePathSignals({ apps: [{ ...liveApp, publishType: "component" }] }).hasPublishedApp).toBe(false)
    expect(derivePathSignals({ apps: [{ ...liveApp, isActive: false }, liveApp] }).hasPublishedApp).toBe(true)
  })

  it("treats an app without a publish type as a MiniApp (older rows)", () => {
    expect(derivePathSignals({ apps: [{ isActive: true, deletedAt: null }] }).hasPublishedApp).toBe(true)
  })
})

describe("computePathProgress", () => {
  it("lists the three steps in order", () => {
    const progress = computePathProgress({
      hasGeneratedImage: false,
      hasMultiNodeWorkflow: false,
      hasPublishedApp: false,
    })
    expect(progress.steps.map((s) => s.id)).toEqual(["image", "workflow", "miniapp"])
    expect(progress.doneCount).toBe(0)
    expect(progress.level).toBe("newcomer")
  })

  it("marks each finished step and levels up with the count", () => {
    const progress = computePathProgress({
      hasGeneratedImage: true,
      hasMultiNodeWorkflow: true,
      hasPublishedApp: false,
    })
    expect(progress.steps.map((s) => s.done)).toEqual([true, true, false])
    expect(progress.doneCount).toBe(2)
    expect(progress.level).toBe("builder")
  })

  it("reaches the top level when all three are done", () => {
    const progress = computePathProgress({
      hasGeneratedImage: true,
      hasMultiNodeWorkflow: true,
      hasPublishedApp: true,
    })
    expect(progress.doneCount).toBe(3)
    expect(progress.level).toBe("creator")
  })

  it("levels on the count, not on which steps are done", () => {
    const progress = computePathProgress({
      hasGeneratedImage: false,
      hasMultiNodeWorkflow: false,
      hasPublishedApp: true,
    })
    expect(progress.level).toBe("explorer")
  })
})
