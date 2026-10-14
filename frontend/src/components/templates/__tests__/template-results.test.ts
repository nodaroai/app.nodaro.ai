// @vitest-environment node
import { describe, expect, it } from "vitest"
import { templateResults } from "../template-results"

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data })

describe("templateResults", () => {
  it("lists the declared outputs first, then the intermediate results, and skips inputs and empty nodes", () => {
    const nodes = [
      node("product", "upload-image", { label: "Product", url: "https://cdn/x/p.png", presentationInput: true }),
      node("frame-1", "generate-image", { label: "Keyframe 1", generatedResults: [{ url: "https://cdn/i/f1.png" }], activeResultIndex: 0 }),
      node("story", "llm-chat", { label: "Story", generatedText: "…" }),
      node("spot", "merge-video-audio", {
        label: "TV spot",
        presentationOutput: true,
        generatedResults: [{ url: "https://cdn/v/spot.mp4", thumbnailUrl: "https://cdn/t/spot.png" }],
        activeResultIndex: 0,
      }),
      node("music", "suno-generate", { label: "Soundtrack", generatedResults: [{ url: "https://cdn/a/track.wav" }], activeResultIndex: 0 }),
    ]
    expect(templateResults(nodes)).toEqual([
      { nodeId: "spot", label: "TV spot", kind: "video", url: "https://cdn/v/spot.mp4", posterUrl: "https://cdn/t/spot.png" },
      { nodeId: "frame-1", label: "Keyframe 1", kind: "image", url: "https://cdn/i/f1.png" },
      { nodeId: "music", label: "Soundtrack", kind: "audio", url: "https://cdn/a/track.wav" },
    ])
  })

  it("honours the active result and falls back to the legacy url fields", () => {
    const nodes = [
      node("take", "generate-video", {
        label: "The take",
        generatedResults: [{ url: "https://cdn/v/old.mp4" }, { url: "https://cdn/v/new.mp4" }],
        activeResultIndex: 1,
      }),
      node("clip", "generate-video", { label: "Clip", generatedVideoUrl: "https://cdn/v/legacy" }),
      node("voice", "text-to-speech", { label: "Voice", generatedAudioUrl: "https://cdn/a/legacy" }),
    ]
    expect(templateResults(nodes).map((r) => [r.nodeId, r.kind, r.url])).toEqual([
      ["take", "video", "https://cdn/v/new.mp4"],
      ["clip", "video", "https://cdn/v/legacy"],
      ["voice", "audio", "https://cdn/a/legacy"],
    ])
  })

  it("tolerates malformed snapshot nodes", () => {
    expect(templateResults([null, 42, {}, { id: "x" }, { id: "y", data: null }])).toEqual([])
  })

  it("hands only web URLs to a media element — snapshot data is publisher-written", () => {
    const nodes = [
      node("a", "generate-video", { generatedResults: [{ url: "javascript:alert(1)" }], activeResultIndex: 0 }),
      node("b", "generate-image", { generatedImageUrl: "data:image/png;base64,AAAA" }),
      node("c", "generate-video", { generatedResults: [{ url: "https://cdn/v/ok.mp4", thumbnailUrl: "file:///etc/passwd" }], activeResultIndex: 0 }),
    ]
    expect(templateResults(nodes)).toEqual([{ nodeId: "c", label: "generate-video", kind: "video", url: "https://cdn/v/ok.mp4" }])
  })
})
