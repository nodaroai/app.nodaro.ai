/**
 * Canvas-side routing for 3D Render Pro's `stills` handle — mirrors the
 * orchestrator's pro-3d-stills-resolver suite, because the two resolvers fail
 * independently.
 *
 * The property under test is the one the contract names and the extractor
 * cannot express: the WHOLE ordered set reaches the consumer, not just the
 * first still. 3D Render Pro is also a video producer, so this is exactly the
 * wiring a generic video branch could swallow before the handle is consulted.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const STILLS = [
  { shotIndex: 0, frame: 0, assetId: "a", url: "https://api.example/v1/3d-scene/deliveries/j/assets/a" },
  { shotIndex: 1, frame: 48, assetId: "b", url: "https://api.example/v1/3d-scene/deliveries/j/assets/b" },
]
const VIDEO = "https://cdn.example/pro.mp4"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const edge = (source: string, target: string, sourceHandle?: string, targetHandle?: string): WorkflowEdge =>
  ({ id: `${source}->${target}`, source, target, sourceHandle, targetHandle }) as WorkflowEdge

const pro = (shotStills?: typeof STILLS) =>
  node("pro", "pro-3d-render", {
    scenePlan: { planType: "3d-scene", revisionId: "r" },
    activeResultIndex: 0,
    generatedResults: [{ url: VIDEO, jobId: "j", ...(shotStills ? { shotStills } : {}) }],
  })

describe("resolveNodeInputs — 3D Render Pro stills (canvas)", () => {
  it("spreads the WHOLE ordered set into referenceImageUrls", () => {
    const target = node("gi", "generate-image")
    const inputs = resolveNodeInputs(target, [pro(STILLS), target], [edge("pro", "gi", "stills", "references")])
    expect(inputs.referenceImageUrls).toEqual(STILLS.map((still) => still.url))
  })

  it("appends to references already wired from another producer", () => {
    const upload = node("up", "upload-image", { url: "https://x/up.png", imageUrl: "https://x/up.png" })
    const target = node("gi", "generate-image")
    const inputs = resolveNodeInputs(
      target,
      [upload, pro(STILLS), target],
      [edge("up", "gi", undefined, "references"), edge("pro", "gi", "stills", "references")],
    )
    expect(inputs.referenceImageUrls).toEqual(["https://x/up.png", ...STILLS.map((still) => still.url)])
  })

  it("routes the video handle as video — the new handle steals nothing", () => {
    const target = node("iv", "image-to-video")
    const inputs = resolveNodeInputs(target, [pro(STILLS), target], [edge("pro", "iv", "video")])
    expect(inputs.referenceImageUrls ?? []).not.toContain(STILLS[0].url)
    expect(inputs.videoUrl ?? inputs.imageUrl ?? "").not.toBe(STILLS[0].url)
  })

  it("adds nothing when this result rendered no stills", () => {
    const target = node("gi", "generate-image")
    const inputs = resolveNodeInputs(target, [pro(), target], [edge("pro", "gi", "stills", "references")])
    expect(inputs.referenceImageUrls ?? []).toEqual([])
  })
})
