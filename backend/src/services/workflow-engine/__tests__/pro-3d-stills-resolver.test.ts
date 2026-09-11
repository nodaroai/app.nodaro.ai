/**
 * The `stills` handle through the ORCHESTRATOR's input resolver.
 *
 * `getPrimaryOutput` answering the first URL is not the contract — "carries
 * the URLs in order" is, and the only place that happens is the spread into
 * `referenceImageUrls`. 3D Render Pro is also a VIDEO producer, so this is
 * exactly the wiring that a generic video branch could swallow before the
 * handle is ever consulted.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getNodeOutput } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

const STILLS = [
  { shotIndex: 0, frame: 0, assetId: "a", url: "https://api.example/v1/3d-scene/deliveries/j/assets/a" },
  { shotIndex: 1, frame: 48, assetId: "b", url: "https://api.example/v1/3d-scene/deliveries/j/assets/b" },
]
const VIDEO = "https://cdn.example/pro.mp4"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode =>
  ({ id, type, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): SimpleEdge =>
  ({ id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null })
const settled = (): Record<string, NodeExecutionState> => ({
  pro: { status: "completed", output: { videoUrl: VIDEO, plan: { revisionId: "r" }, shotStills: STILLS } },
})

describe("3D Render Pro stills → downstream referenceImageUrls", () => {
  it("spreads the WHOLE ordered set, not just the first still", () => {
    const result = resolveNodeInputs(
      node("gi", "generate-image"),
      [edge("pro", "gi", "stills", "references")],
      settled(),
      [node("pro", "pro-3d-render"), node("gi", "generate-image")],
    )
    expect(result.referenceImageUrls).toEqual(STILLS.map((still) => still.url))
  })

  it("resolves from the settled job only — exactly like the video handle", () => {
    // 3D Render Pro is EXECUTED, not a source node, so with no state on this
    // engine neither handle resolves; a resumed run is seeded from the
    // persisted job row instead. Asserted so the two handles cannot drift into
    // different reachability, which would look like "stills sometimes work".
    const pro = node("pro", "pro-3d-render", {
      activeResultIndex: 0,
      generatedResults: [{ url: VIDEO, jobId: "j", shotStills: STILLS }],
    })
    expect(getNodeOutput(pro, "stills", {})).toBeUndefined()
    expect(getNodeOutput(pro, "video", {})).toBeUndefined()
    const result = resolveNodeInputs(
      node("gi", "generate-image"),
      [edge("pro", "gi", "stills", "references")],
      {},
      [pro, node("gi", "generate-image")],
    )
    expect(result.referenceImageUrls ?? []).toEqual([])
  })

  it("leaves the video handle a video — the new handle steals nothing", () => {
    const result = resolveNodeInputs(
      node("iv", "image-to-video"),
      [edge("pro", "iv", "video")],
      settled(),
      [node("pro", "pro-3d-render"), node("iv", "image-to-video")],
    )
    expect(result.referenceImageUrls ?? []).not.toContain(STILLS[0].url)
    expect(getNodeOutput(node("pro", "pro-3d-render"), "video", settled())).toBe(VIDEO)
    expect(getNodeOutput(node("pro", "pro-3d-render"), "stills", settled())).toBe(STILLS[0].url)
  })

  it("adds nothing when the run rendered no stills", () => {
    const result = resolveNodeInputs(
      node("gi", "generate-image"),
      [edge("pro", "gi", "stills", "references")],
      { pro: { status: "completed", output: { videoUrl: VIDEO } } },
      [node("pro", "pro-3d-render"), node("gi", "generate-image")],
    )
    expect(result.referenceImageUrls ?? []).toEqual([])
  })
})
