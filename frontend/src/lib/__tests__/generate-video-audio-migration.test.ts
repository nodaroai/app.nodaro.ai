import { describe, expect, it } from "vitest"
import { migrateGenerateVideoAudioInput } from "../generate-video-audio-migration"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * A graph saved with a wire into Generate Video's retired "Audio" input loads
 * the way it ran: a Merge Video & Audio node after the clip (LTX 2.3 Pro: the
 * wire moves to Audio Refs; LTX 2.3 Fast never read it).
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}, x = 0): WorkflowNode =>
  ({ id, type, position: { x, y: 10 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id, source, sourceHandle, target, targetHandle }) as WorkflowEdge

const song = node("song", "upload-audio", { url: "https://cdn.example/song.mp3" })
const after = node("after", "add-captions")
const graph = (data: Record<string, unknown>) => ({
  nodes: [song, node("gv", "generate-video", data, 100), after],
  edges: [
    edge("e-audio", "song", "audio", "gv", "audio"),
    edge("e-out", "gv", "video", "after", "video"),
  ],
})

describe("migrateGenerateVideoAudioInput", () => {
  it("lays the track on with a Merge Video & Audio node after the clip, mixed as the run mixed it", () => {
    const { nodes, edges } = graph({ provider: "kling-4", generateAudio: true })
    const out = migrateGenerateVideoAudioInput(nodes, edges)
    const merge = out.nodes.find((n) => n.type === "merge-video-audio")!
    expect(merge.id).toBe("gv-audio-merge")
    expect(merge.data).toMatchObject({ voiceoverVolume: 100, keepOriginalAudio: true, originalAudioVolume: 30 })
    expect(merge.position.x).toBeGreaterThan(100)

    expect(out.edges.some((e) => e.targetHandle === "audio")).toBe(false)
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "gv", sourceHandle: "video", target: merge.id, targetHandle: "in" }))
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "song", target: merge.id, targetHandle: "in" }))
    // What the clip fed now comes from the merge.
    expect(out.edges).toContainEqual(expect.objectContaining({ id: "e-out", source: merge.id, sourceHandle: "video-out", target: "after" }))
  })

  it("drops the clip's own sound when the node did not generate audio (the server's mix)", () => {
    const { nodes, edges } = graph({ provider: "seedance-2-5" })
    const merge = migrateGenerateVideoAudioInput(nodes, edges).nodes.find((n) => n.type === "merge-video-audio")!
    expect((merge.data as { keepOriginalAudio?: boolean }).keepOriginalAudio).toBe(false)
  })

  it("moves the wire to Audio Refs on LTX 2.3 Pro, where it drove the generation", () => {
    const { nodes, edges } = graph({ provider: "ltx-2.3-pro" })
    const out = migrateGenerateVideoAudioInput(nodes, edges)
    expect(out.nodes).toHaveLength(3)
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "song", target: "gv", targetHandle: "audioReferences" }))
    expect(out.edges.some((e) => e.targetHandle === "audio")).toBe(false)
  })

  it("drops the wire on LTX 2.3 Fast, which never read it", () => {
    const { nodes, edges } = graph({ provider: "ltx-2.3-fast" })
    const out = migrateGenerateVideoAudioInput(nodes, edges)
    expect(out.nodes).toHaveLength(3)
    expect(out.edges.map((e) => e.id)).toEqual(["e-out"])
  })

  it("leaves a graph with no such wire alone, and is idempotent", () => {
    const { nodes, edges } = graph({ provider: "kling-4" })
    const once = migrateGenerateVideoAudioInput(nodes, edges)
    const twice = migrateGenerateVideoAudioInput(once.nodes, once.edges)
    expect(twice.nodes).toEqual(once.nodes)
    expect(twice.edges).toEqual(once.edges)
  })

  it("keeps an audio wire into another node type (Generate Video Pro keeps its input)", () => {
    const nodes = [song, node("gvp", "generate-video-pro")]
    const edges = [edge("e", "song", "audio", "gvp", "audio")]
    expect(migrateGenerateVideoAudioInput(nodes, edges).edges).toEqual(edges)
  })
})
