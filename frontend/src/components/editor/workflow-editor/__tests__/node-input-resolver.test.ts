import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveNodeInputs } from "../node-input-resolver"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): any {
  return { id, type, data: { label: type, ...data }, position: { x: 0, y: 0 } }
}

function makeEdge(source: string, target: string): any {
  return { id: `${source}->${target}`, source, target }
}

// ---------------------------------------------------------------------------
// resolveNodeInputs
// ---------------------------------------------------------------------------

describe("resolveNodeInputs", () => {
  it("resolves text-prompt source as prompt input", () => {
    const textNode = makeNode("t1", "text-prompt", { text: "hello" })
    const target = makeNode("t2", "generate-image")
    const edges = [makeEdge("t1", "t2")]

    const inputs = resolveNodeInputs(target, [textNode, target], edges)
    expect(inputs.prompt).toBe("hello")
  })

  it("resolves upload-image as referenceImageUrls for generate-image target", () => {
    const uploadNode = makeNode("u1", "upload-image", { url: "http://img.png" })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("u1", "t1")]

    const inputs = resolveNodeInputs(target, [uploadNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://img.png")
  })

  it("resolves upload-image as imageUrl for image-to-video target", () => {
    const uploadNode = makeNode("u1", "upload-image", { url: "http://img.png" })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("u1", "t1")]

    const inputs = resolveNodeInputs(target, [uploadNode, target], edges)
    expect(inputs.imageUrl).toBe("http://img.png")
  })

  it("resolves character node as referenceImageUrls", () => {
    const charNode = makeNode("c1", "character", {
      sourceImageUrl: "http://char.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("c1", "t1")]

    const inputs = resolveNodeInputs(target, [charNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://char.png")
  })

  it("resolves face node as referenceImageUrls", () => {
    const faceNode = makeNode("f1", "face", {
      sourceImageUrl: "http://face.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("f1", "t1")]

    const inputs = resolveNodeInputs(target, [faceNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://face.png")
  })

  it("resolves multiple upload-video sources into videoUrls for combine-videos", () => {
    const vid1 = makeNode("v1", "upload-video", { url: "http://v1.mp4" })
    const vid2 = makeNode("v2", "upload-video", { url: "http://v2.mp4" })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("v1", "t1"), makeEdge("v2", "t1")]

    const inputs = resolveNodeInputs(target, [vid1, vid2, target], edges)
    expect(inputs.videoUrls).toContain("http://v1.mp4")
    expect(inputs.videoUrls).toContain("http://v2.mp4")
    expect(inputs.videoUrls).toHaveLength(2)
  })

  it("resolves upload-video as videoUrl for non-combine targets", () => {
    const vid = makeNode("v1", "upload-video", { url: "http://v1.mp4" })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("v1", "t1")]

    const inputs = resolveNodeInputs(target, [vid, target], edges)
    expect(inputs.videoUrl).toBe("http://v1.mp4")
  })

  it("resolves text-to-speech as audioSources for merge-video-audio", () => {
    const ttsNode = makeNode("tts", "text-to-speech", {
      generatedResults: [
        { url: "http://audio.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("tts", "t1")]

    const inputs = resolveNodeInputs(target, [ttsNode, target], edges)
    expect(inputs.audioSources).toBeDefined()
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://audio.mp3")
  })

  it("accumulates multiple audio sources into audioUrls for mix-audio", () => {
    const audio1 = makeNode("a1", "text-to-speech", {
      generatedResults: [
        { url: "http://audio1.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const audio2 = makeNode("a2", "upload-audio", {
      r2Url: "http://audio2.mp3",
    })
    const target = makeNode("t1", "mix-audio")
    const edges = [makeEdge("a1", "t1"), makeEdge("a2", "t1")]

    const inputs = resolveNodeInputs(
      target,
      [audio1, audio2, target],
      edges,
    )
    expect(inputs.audioUrls).toBeDefined()
    expect(inputs.audioUrls).toContain("http://audio1.mp3")
    expect(inputs.audioUrls).toContain("http://audio2.mp3")
    expect(inputs.audioUrls).toHaveLength(2)
  })

  it("resolves generate-image as imageUrl for image-to-video target", () => {
    const genImage = makeNode("g1", "generate-image", {
      generatedResults: [
        { url: "http://gen.png", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("g1", "t1")]

    const inputs = resolveNodeInputs(target, [genImage, target], edges)
    expect(inputs.imageUrl).toBe("http://gen.png")
  })

  it("resolves generate-image as referenceImageUrls for another generate-image", () => {
    const genImage = makeNode("g1", "generate-image", {
      generatedResults: [
        { url: "http://gen.png", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("g1", "t1")]

    const inputs = resolveNodeInputs(target, [genImage, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://gen.png")
  })

  it("resolves image-to-video as videoUrl for merge-video-audio", () => {
    const i2v = makeNode("iv1", "image-to-video", {
      generatedResults: [
        { url: "http://video.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("iv1", "t1")]

    const inputs = resolveNodeInputs(target, [i2v, target], edges)
    expect(inputs.videoUrl).toBe("http://video.mp4")
  })

  it("resolves ai-writer output as prompt", () => {
    const writer = makeNode("w1", "ai-writer", {
      generatedText: "A dramatic story",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("w1", "t1")]

    const inputs = resolveNodeInputs(target, [writer, target], edges)
    expect(inputs.prompt).toBe("A dramatic story")
  })

  it("resolves transcribe output as prompt", () => {
    const transcribe = makeNode("tr1", "transcribe", {
      generatedResults: [{ text: "transcribed text" }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "text-to-speech")
    const edges = [makeEdge("tr1", "t1")]

    const inputs = resolveNodeInputs(target, [transcribe, target], edges)
    expect(inputs.prompt).toBe("transcribed text")
  })

  it("resolves combine-text output as prompt", () => {
    const combineText = makeNode("ct1", "combine-text", {
      combinedText: "combined output text",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("ct1", "t1")]

    const inputs = resolveNodeInputs(target, [combineText, target], edges)
    expect(inputs.prompt).toBe("combined output text")
  })

  it("skips source nodes with no output", () => {
    // text-prompt with no text set -> extractNodeOutput returns undefined (or empty)
    const textNode = makeNode("t1", "text-prompt", {})
    const target = makeNode("t2", "generate-image")
    const edges = [makeEdge("t1", "t2")]

    const inputs = resolveNodeInputs(target, [textNode, target], edges)
    // undefined text means extractNodeOutput returns undefined, source skipped
    expect(inputs.prompt).toBeUndefined()
  })

  it("resolves upload-audio as audioSources for merge-video-audio", () => {
    const audioNode = makeNode("a1", "upload-audio", {
      r2Url: "http://uploaded-audio.mp3",
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("a1", "t1")]

    const inputs = resolveNodeInputs(target, [audioNode, target], edges)
    expect(inputs.audioSources).toBeDefined()
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://uploaded-audio.mp3")
  })

  it("resolves multiple image sources as accumulated referenceImageUrls", () => {
    const char = makeNode("c1", "character", {
      sourceImageUrl: "http://char.png",
    })
    const upload = makeNode("u1", "upload-image", {
      url: "http://upload.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("c1", "t1"), makeEdge("u1", "t1")]

    const inputs = resolveNodeInputs(
      target,
      [char, upload, target],
      edges,
    )
    expect(inputs.referenceImageUrls).toContain("http://char.png")
    expect(inputs.referenceImageUrls).toContain("http://upload.png")
    expect(inputs.referenceImageUrls).toHaveLength(2)
  })

  it("resolves video-type sources into videoUrls for combine-videos", () => {
    const i2v = makeNode("iv1", "image-to-video", {
      generatedResults: [
        { url: "http://v1.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const t2v = makeNode("tv1", "text-to-video", {
      generatedResults: [
        { url: "http://v2.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("iv1", "t1"), makeEdge("tv1", "t1")]

    const inputs = resolveNodeInputs(target, [i2v, t2v, target], edges)
    expect(inputs.videoUrls).toContain("http://v1.mp4")
    expect(inputs.videoUrls).toContain("http://v2.mp4")
    expect(inputs.videoUrls).toHaveLength(2)
  })

  it("resolves list node output as prompt", () => {
    const listNode = makeNode("l1", "list", {
      items: "first item\nsecond item",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("l1", "t1")]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("first item")
  })
})
