/**
 * The canvas's answer to "what will this render cost" must be the answer the
 * charge uses.
 *
 * A 3D scene render is priced by frame size, and the frame lives in the plan —
 * which the render node usually does NOT hold: it arrives from an upstream
 * composer at run time. These cases pin that the estimate looks in both places
 * with the orchestrator's precedence, and that it agrees with
 * `renderVideoCreditId` (the function the route and the orchestrator both call
 * on the body they are actually about to run).
 */
import { describe, it, expect } from "vitest"
import { renderVideoCreditId } from "@nodaro/shared"
import { resolveRenderVideoPlan, renderVideoCreditIdForNode } from "../render-video-plan"

const scene = (width: number, height: number) => ({
  planType: "3d-scene",
  schemaVersion: 1,
  revisionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  width,
  height,
  fps: 24,
  durationInFrames: 96,
})

const renderNode = (data: Record<string, unknown> = {}) => ({ id: "r1", type: "render-video", data })
const composer = (plan: Record<string, unknown>) => ({ id: "s1", type: "generate-3d-scene", data: { scenePlan: plan } })
const wired = [{ source: "s1", target: "r1" }]

describe("resolveRenderVideoPlan", () => {
  it("finds the plan an upstream composer holds", () => {
    const plan = scene(2560, 1440)
    expect(resolveRenderVideoPlan(renderNode(), [composer(plan), renderNode()], wired)).toEqual({
      planType: "3d-scene",
      plan,
    })
  })

  it("prefers a plan written onto the node itself", () => {
    const own = scene(2560, 2560)
    const upstream = scene(1920, 1080)
    expect(
      resolveRenderVideoPlan(renderNode({ planType: "3d-scene", plan: own }), [composer(upstream), renderNode()], wired)
        .plan,
    ).toEqual(own)
  })

  it("lets a plan declare its own planType over the composer's default", () => {
    const lottie = { planType: "lottie-graphic", width: 2560, height: 2560 }
    const resolved = resolveRenderVideoPlan(renderNode(), [{ id: "s1", type: "motion-graphics", data: { motionPlan: lottie } }, renderNode()], wired)
    expect(resolved.planType).toBe("lottie-graphic")
  })

  it("answers empty rather than guessing when nothing is wired", () => {
    expect(resolveRenderVideoPlan(renderNode())).toEqual({})
    expect(resolveRenderVideoPlan(renderNode(), [renderNode()], [])).toEqual({})
    expect(resolveRenderVideoPlan(renderNode(), [{ id: "s1", type: "generate-image", data: {} }, renderNode()], wired)).toEqual({})
  })
})

describe("renderVideoCreditIdForNode", () => {
  it.each([
    { width: 1920, height: 1080, id: "render-video" },
    { width: 1920, height: 1920, id: "render-video" },
    { width: 2560, height: 1440, id: "render-video:3d-large" },
    { width: 2048, height: 2560, id: "render-video:3d-xlarge" },
    { width: 2560, height: 2560, id: "render-video:3d-xlarge" },
  ])("quotes $id for a $width x $height upstream scene", ({ width, height, id }) => {
    const plan = scene(width, height)
    const nodes = [composer(plan), renderNode()]
    expect(renderVideoCreditIdForNode(renderNode(), nodes, wired)).toBe(id)
    // The estimate and the charge read the same function on the same plan.
    expect(renderVideoCreditIdForNode(renderNode(), nodes, wired)).toBe(
      renderVideoCreditId({ planType: "3d-scene", plan }),
    )
  })

  it("falls back to the flat, configured row when it cannot see the plan", () => {
    expect(renderVideoCreditIdForNode(renderNode())).toBe("render-video")
  })

  it("leaves a non-3D composition on the flat row", () => {
    const sceneGraph = { width: 3840, height: 2160 }
    const nodes = [{ id: "s1", type: "video-composer", data: { sceneGraph } }, renderNode()]
    expect(renderVideoCreditIdForNode(renderNode(), nodes, wired)).toBe("render-video")
  })
})
