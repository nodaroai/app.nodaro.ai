/**
 * Replace Audio's inputs route by TARGET HANDLE, never by source type: the wire
 * into `in` is the video whose sound is replaced, and every wire into `music`
 * adds a music source — an audio or a video alike — so the shared body can
 * refuse a second one instead of dropping it.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, fieldMappings: {}, ...data } }) as WorkflowNode
const edge = (source: string, target: string, targetHandle?: string, sourceHandle?: string): WorkflowEdge =>
  ({ id: `${source}->${target}:${targetHandle ?? ""}`, source, target, ...(targetHandle ? { targetHandle } : {}), ...(sourceHandle ? { sourceHandle } : {}) }) as WorkflowEdge

const video = node("vid", "upload-video", { url: "https://r2/clip.mp4" })
const song = node("song", "upload-audio", { url: "https://r2/song.mp3" })
const otherVideo = node("bg", "upload-video", { url: "https://r2/bg.mp4" })
const target = node("ra", "replace-audio", { musicSource: "input", musicPrompt: "", mode: "keep-speech", musicVolume: 80, speechVolume: 100, duckAmount: 70 })

describe("resolveNodeInputs — replace-audio", () => {
  it("the wire into `in` is the video, the wire into `music` a music source", () => {
    const inputs = resolveNodeInputs(target, [video, song, target], [edge("vid", "ra", "in"), edge("song", "ra", "music")])
    expect(inputs.videoUrl).toBe("https://r2/clip.mp4")
    expect(inputs.musicUrls).toEqual(["https://r2/song.mp3"])
    expect(inputs.audioUrl).toBeUndefined()
  })

  it("a video wired into `music` is a music source (its sound is used), never the video", () => {
    const inputs = resolveNodeInputs(target, [video, otherVideo, target], [edge("bg", "ra", "music"), edge("vid", "ra", "in")])
    expect(inputs.videoUrl).toBe("https://r2/clip.mp4")
    expect(inputs.musicUrls).toEqual(["https://r2/bg.mp4"])
  })

  it("every wire into `music` is kept, in edge order (the body refuses more than one)", () => {
    const inputs = resolveNodeInputs(target, [video, song, otherVideo, target], [edge("vid", "ra", "in"), edge("song", "ra", "music"), edge("bg", "ra", "music")])
    expect(inputs.musicUrls).toEqual(["https://r2/song.mp3", "https://r2/bg.mp4"])
  })

  it("nothing on `music` leaves no music list", () => {
    const inputs = resolveNodeInputs(target, [video, target], [edge("vid", "ra", "in")])
    expect(inputs.videoUrl).toBe("https://r2/clip.mp4")
    expect(inputs.musicUrls).toBeUndefined()
  })

  it("a wire on neither handle is never a music source (it routes as on any node)", () => {
    const inputs = resolveNodeInputs(target, [video, song, target], [edge("vid", "ra", "in"), edge("song", "ra")])
    expect(inputs.videoUrl).toBe("https://r2/clip.mp4")
    expect(inputs.musicUrls).toBeUndefined()
  })
})
