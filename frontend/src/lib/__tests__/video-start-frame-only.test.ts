import { describe, it, expect } from "vitest"
import { videoStartFrameOnlyMessage, videoStartFrameOnlyProblem } from "@nodaro/shared/models"
import { nodeStartFrameOnlyProblem, offersVideoResolution, startFrameOnlyText, wiredVideoFrames } from "../video-start-frame-only"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const GROK = "grok-imagine-video-1.5"
const edge = (targetHandle: string, i = 0) => ({ id: `e${i}-${targetHandle}`, source: `s${i}`, target: "v", targetHandle })

describe("wiredVideoFrames", () => {
  it("reads the end frame and the Image References of one node, on either handle spelling", () => {
    const edges = [edge("startFrame"), edge("endFrame", 1), edge("imageReferences", 2), edge("references", 3), { ...edge("endFrame", 4), target: "other" }]
    expect(wiredVideoFrames("v", edges)).toEqual({ hasEndFrame: true, inBetweenFrameCount: 2 })
    expect(wiredVideoFrames("v", [edge("startFrame"), edge("assets", 1)])).toEqual({ hasEndFrame: false, inBetweenFrameCount: 0 })
  })
})

describe("the editor's sentence is the server's, word for word (English)", () => {
  const problem = videoStartFrameOnlyProblem(GROK, { resolution: "1080p", hasEndFrame: true, inBetweenFrameCount: 0 })!

  it("the note beside the setting", () => {
    expect(startFrameOnlyText(GROK, problem, "vidcfg.startFrameOnlyResolution")).toBe(videoStartFrameOnlyMessage(GROK, "1080p"))
  })

  it("the refused Run, which says nothing was charged", () => {
    expect(startFrameOnlyText(GROK, problem, "nodeRun.startFrameOnlyResolution")).toBe(
      videoStartFrameOnlyMessage(GROK, "1080p", { nothingCharged: true }),
    )
  })
})

describe("offersVideoResolution", () => {
  const none = { hasEndFrame: false, inBetweenFrameCount: 0 }
  const end = { hasEndFrame: true, inBetweenFrameCount: 0 }
  const mids = { hasEndFrame: false, inBetweenFrameCount: 2 }

  it("offers 1080p with nothing but a start frame wired, and hides it beside other frames", () => {
    expect(offersVideoResolution(GROK, "1080p", {}, none)).toBe(true)
    expect(offersVideoResolution(GROK, "1080p", {}, end)).toBe(false)
    expect(offersVideoResolution(GROK, "1080p", { duration: 8 }, mids)).toBe(false)
  })

  it("always offers 480p and 720p", () => {
    for (const frames of [none, end, mids]) {
      expect(offersVideoResolution(GROK, "480p", {}, frames)).toBe(true)
      expect(offersVideoResolution(GROK, "720p", {}, frames)).toBe(true)
    }
  })

  it("keeps the node's saved 1080p offered (never snapped away)", () => {
    expect(offersVideoResolution(GROK, "1080p", { resolution: "1080p" }, end)).toBe(true)
  })

  it("offers 1080p when the clip's length leaves every in-between frame out", () => {
    expect(offersVideoResolution(GROK, "1080p", { duration: 1 }, mids)).toBe(true)
  })

  it("never hides a tier of a model that declares none", () => {
    expect(offersVideoResolution("kling-4-keyframes", "1080p", {}, { hasEndFrame: true, inBetweenFrameCount: 3 })).toBe(true)
  })

  it("the note shows exactly when the run would be refused", () => {
    expect(nodeStartFrameOnlyProblem(GROK, { resolution: "1080p" }, end)).toBeDefined()
    expect(nodeStartFrameOnlyProblem(GROK, { resolution: "1080p" }, none)).toBeUndefined()
    expect(nodeStartFrameOnlyProblem(GROK, { resolution: "720p" }, end)).toBeUndefined()
  })
})

describe("the Run estimate prices no refused run", () => {
  const grokNode = (resolution: string): WorkflowNode =>
    ({ id: "v", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "Video", provider: GROK, resolution, duration: 8 } }) as unknown as WorkflowNode
  const upload = (id: string): WorkflowNode =>
    ({ id, type: "upload-image", position: { x: 0, y: 0 }, data: { label: id, url: `https://cdn.example/${id}.png` } }) as unknown as WorkflowNode
  const wires = (...handles: string[]): WorkflowEdge[] =>
    handles.map((targetHandle, i) => ({ id: `e${i}`, source: `u${i}`, target: "v", sourceHandle: null, targetHandle }) as unknown as WorkflowEdge)
  const line = (resolution: string, handles: string[]) => {
    const node = grokNode(resolution)
    const nodes = [node, ...handles.map((_, i) => upload(`u${i}`))]
    return estimateRunCreditLines([node], nodes, wires(...handles), () => 100).find((l) => l.nodeId === "v")!
  }

  it("a 1080p run with an end frame is left out of the total, with the refusal's sentence", () => {
    const l = line("1080p", ["startFrame", "endFrame"])
    expect(l.unpriced).toBe(true)
    expect(l.credits).toBe(0)
    expect(l.unpricedMessage).toBe(videoStartFrameOnlyMessage(GROK, "1080p"))
  })

  it("a 720p run with the same frames, and a 1080p start-only run, are priced", () => {
    expect(line("720p", ["startFrame", "endFrame"]).unpriced).toBeUndefined()
    expect(line("1080p", ["startFrame"]).unpriced).toBeUndefined()
  })
})
