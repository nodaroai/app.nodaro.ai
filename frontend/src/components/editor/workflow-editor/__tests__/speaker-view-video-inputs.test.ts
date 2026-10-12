/**
 * Speaker View's `video` lane on the canvas (decided 2026-10-11): the wired
 * video reaches `inputs.videoUrl` on the generic video lane Speaker Frames'
 * bare video takes, so one upload hands both consumers the SAME string — the
 * tracks' file check compares them byte for byte. The mirror of the backend
 * resolver (speaker-view-dag.test.ts).
 */
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const nodes = [
  { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Video", url: URL } },
  { id: "tx", type: "transcribe", position: { x: 0, y: 0 }, data: { label: "Transcribe", generatedResults: [{ url: "", transcript: { words: [] } }] } },
  { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames" } },
  { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View" } },
] as unknown as WorkflowNode[]
const edges = [
  { id: "e1", source: "up", sourceHandle: "video", target: "sv", targetHandle: "video" },
  { id: "e2", source: "up", sourceHandle: "video", target: "sf", targetHandle: "video" },
] as unknown as WorkflowEdge[]

describe("the video lane", () => {
  it("routes the wired video onto inputs.videoUrl and leaves the edit lane empty", () => {
    const inputs = resolveNodeInputs(nodes[3]!, nodes, edges)
    expect(inputs.videoUrl).toBe(URL)
    expect(inputs.edl).toBeUndefined()
  })

  it("hands Speaker View and Speaker Frames the same string for one upload", () => {
    const forView = resolveNodeInputs(nodes[3]!, nodes, edges).videoUrl
    const forFrames = resolveNodeInputs(nodes[2]!, nodes, edges).videoUrl
    expect(forView).toBe(forFrames)
    expect(typeof forView).toBe("string")
  })
})
