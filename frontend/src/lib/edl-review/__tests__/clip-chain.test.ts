import { describe, expect, it } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"
import { clipRenderChain } from "../clip-chain"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

// "Render final: Render Clip ×6 → Caption Clip ×6" (§4.2, A4-2): the nodes of
// Render final's run, in run order, with the times each runs.
const SOURCES = [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }]
const clip = (i: number) => ({
  version: 1,
  clock: "master",
  sources: SOURCES,
  segments: [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "cam" }],
  dropped: [],
  meta: { title: `Clip ${i}` },
})
const PLAN = Array.from({ length: 6 }, (_, i) => clip(i))
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string) =>
  ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle, data: { outputMode: "each" } }) as unknown as WorkflowEdge

describe("clipRenderChain", () => {
  const nodes = [
    node("plan", "edit-plan", { label: "Find Clips", mode: "clips", generatedJson: PLAN, editedEdl: { v: 1, kind: "clips", basis: "x", clips: [] } }),
    node("render", "apply-edl", { label: "Render Clip", quality: "proxy" }),
    node("caption", "add-captions", { label: "Caption Clip" }),
  ]
  const edges = [edge("plan", "render", "edl", "edl"), edge("render", "caption", "video", "video")]

  it("names the render and what follows it, each with its times, the plan not among them", () => {
    const chain = clipRenderChain("render", nodes, edges)
    expect(chain.map((s) => s.label)).toEqual(["Render Clip", "Caption Clip"])
    expect(chain.map((s) => s.times)).toEqual([6, 6])
    expect(chain.map((s) => s.nodeId)).not.toContain("plan")
  })

  it("counts the kept clips only: a clip the review drops is not rendered", () => {
    const dropped = nodes.map((n) =>
      n.id === "plan" ? ({ ...n, data: { ...n.data, editedEdl: { v: 1, kind: "clips", basis: editPlanBasis(PLAN), clips: PLAN.map((_, i) => ({ keep: i !== 2 })) } } } as WorkflowNode) : n,
    )
    expect(clipRenderChain("render", dropped, edges).map((s) => s.times)).toEqual([5, 5])
  })

  it("is empty for a node that is not a render", () => {
    expect(clipRenderChain("plan", nodes, edges)).toEqual([])
    expect(clipRenderChain("missing", nodes, edges)).toEqual([])
  })

  it("lists a node after the nodes that feed it, whatever the canvas order", () => {
    const shuffled = [nodes[2]!, nodes[0]!, nodes[1]!]
    expect(clipRenderChain("render", shuffled, edges).map((s) => s.label)).toEqual(["Render Clip", "Caption Clip"])
  })
})

describe("clipRenderChain of a review-on Clip Pack node (its Render final continues its own run)", () => {
  const WRAPPER = "00000000-0000-4000-8000-0000000000c1"
  const PACK = PLAN.slice(0, 2)
  const SETTINGS = { reviewBeforeRender: true, captions: true }
  const pack = (data: Record<string, unknown> = {}) =>
    node("cp", "clip-pack", {
      label: "Clip Pack", executionStatus: "completed", generatedJson: PACK, ...SETTINGS,
      generatedResults: [0, 1].map((i) => ({ url: `https://cdn.test/p${i}.mp4`, quality: "proxy", jobId: WRAPPER, useCaseSettings: SETTINGS })),
      ...data,
    })
  const video = node("rec", "upload-video", { url: "https://cdn.test/cam.mp4" })
  const audio = node("rec", "upload-audio", { url: "https://cdn.test/ep.mp3" })
  const wire = (pip: string) => [edge("rec", "cp", pip, "media")]

  it("2 kept clips: its render and its captions, each twice", () => {
    expect(clipRenderChain("cp", [video, pack()], wire("video")).map((s) => [s.label, s.times])).toEqual([["Render Clip", 2], ["Caption Clip", 2]])
  })

  it("a clip the review drops is neither rendered nor captioned", () => {
    const editedEdl = { v: 1, kind: "clips", basis: editPlanBasis(PACK), clips: [{ keep: true }, { keep: false }] }
    expect(clipRenderChain("cp", [video, pack({ editedEdl })], wire("video")).map((s) => [s.label, s.times])).toEqual([["Render Clip", 1], ["Caption Clip", 1]])
  })

  it("then every canvas node after the pack, once per kept clip (its clips wire reads each clip)", () => {
    const after = node("up", "add-captions", { label: "Subtitles" })
    const out = { id: "cp-up", source: "cp", target: "up", sourceHandle: "clips", targetHandle: "video" } as unknown as WorkflowEdge
    expect(clipRenderChain("cp", [video, pack(), after], [...wire("video"), out]).map((s) => [s.nodeId, s.label, s.times])).toEqual([
      ["cp::uc-render", "Render Clip", 2],
      ["cp::uc-captions", "Caption Clip", 2],
      ["up", "Subtitles", 2],
    ])
  })

  it("an audio pack has no captions: its render alone", () => {
    expect(clipRenderChain("cp", [audio, pack()], wire("audio")).map((s) => [s.label, s.times])).toEqual([["Render Clip", 2]])
  })

  it("is empty when the node has no Render final (its take on show is a Final)", () => {
    const finals = [0, 1].map((i) => ({ url: `https://cdn.test/f${i}.mp4`, quality: "final", jobId: WRAPPER }))
    expect(clipRenderChain("cp", [video, pack({ generatedResults: finals })], wire("video"))).toEqual([])
  })
})
