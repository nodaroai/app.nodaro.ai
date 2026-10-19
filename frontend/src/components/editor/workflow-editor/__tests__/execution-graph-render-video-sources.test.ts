// @vitest-environment node
// @test-watches frontend/src/nodes/**
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

import { VIDEO_SOURCE_TYPES_FOR_RENDER, collectMediaAssets, detectPreviewItemType } from "../execution-graph"

/**
 * VIDEO_SOURCE_TYPES_FOR_RENDER = the legacy rows ∪ every node unit whose
 * contract.producer is "video" (decided 2026-10-18). The legacy rows below are
 * origin/dev's literal, less gif-to-video, which left it when it became a unit
 * (decided 2026-10-18) and stays a member through its contract.producer
 * "video". remove-audio and gif-to-video are the real units that join
 * (tighten-episode is "dynamic", episode-chapters has no producer).
 */
const LEGACY_RENDER_VIDEO_SOURCES = [
  "image-to-video", "video-to-video", "switchx", "text-to-video", "generate-video", "generate-video-pro",
  "edit-video-pro", "upload-video", "youtube-video", "combine-videos", "assemble-narrated-video", "lip-sync",
  "speech-to-video", "ai-avatar", "cinematic-avatar", "motion-transfer", "video-upscale", "video-depth",
  "extend-video", "video-retake", "face-swap", "suno-music-video", "merge-video-audio", "still-to-video",
  "slideshow", "add-captions", "resize-video", "social-media-format", "trim-video", "render-video",
  "speed-ramp", "loop-video", "fade-video", "video-overlay", "transcode-video", "manual-edit",
  "video-sfx", "ugc-clip", "video-mask", "mask-composite",
]

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as any

describe("VIDEO_SOURCE_TYPES_FOR_RENDER", () => {
  it("is the legacy rows, unchanged and in order, then the video-producing units (remove-audio, gif-to-video)", () => {
    expect([...VIDEO_SOURCE_TYPES_FOR_RENDER].slice(0, LEGACY_RENDER_VIDEO_SOURCES.length)).toEqual(LEGACY_RENDER_VIDEO_SOURCES)
    expect([...VIDEO_SOURCE_TYPES_FOR_RENDER].slice(LEGACY_RENDER_VIDEO_SOURCES.length).sort()).toEqual(["gif-to-video", "remove-audio"])
  })

  it("leaves out a dynamic-producer unit and a unit with no producer", () => {
    expect(VIDEO_SOURCE_TYPES_FOR_RENDER.has("tighten-episode")).toBe(false)
    expect(VIDEO_SOURCE_TYPES_FOR_RENDER.has("episode-chapters")).toBe(false)
  })
})

describe("a Remove Audio source wired into a render", () => {
  const URL = "https://cdn.example/silent"
  const render = node("r", "render-video")
  const removeAudio = node("s", "remove-audio", { generatedVideoUrl: URL })

  it("collectMediaAssets collects its output as a video", () => {
    const assets = collectMediaAssets(render, [{ id: "e", source: "s", target: "r" }] as any, [removeAudio, render])
    expect(assets).toEqual([{ id: "s", type: "video", url: URL, label: "remove-audio", thumbnailUrl: undefined }])
  })

  it("collects the active take, as every video node's output is read", () => {
    const takes = node("s", "remove-audio", { generatedVideoUrl: URL, activeResultIndex: 1, generatedResults: [{ url: "https://a/0.mp4" }, { url: "https://a/1.mp4", thumbnailUrl: "https://a/1.jpg" }] })
    const assets = collectMediaAssets(render, [{ id: "e", source: "s", target: "r" }] as any, [takes, render])
    expect(assets).toEqual([{ id: "s", type: "video", url: "https://a/1.mp4", label: "remove-audio", thumbnailUrl: "https://a/1.jpg" }])
  })

  it("previews as a video whatever its URL looks like", () => {
    expect(detectPreviewItemType("remove-audio", URL)).toBe("video")
  })
})
