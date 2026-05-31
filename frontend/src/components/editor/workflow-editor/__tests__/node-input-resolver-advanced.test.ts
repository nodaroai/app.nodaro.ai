import { describe, it, expect, vi, beforeEach } from "vitest"

const mockBuildScenePrompt = vi.fn()
const mockCharacterDefinitions: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: mockCharacterDefinitions }),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: (...args: unknown[]) => mockBuildScenePrompt(...args),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: vi.fn(),
}))

import {
  resolveNodeInputs,
  extractNodeOutputAsList,
  getListInputForNode,
} from "../node-input-resolver"
import { extractNodeOutput } from "../execution-graph"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): any {
  return { id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): any {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    targetHandle: targetHandle ?? undefined,
  }
}

const mockExtractNodeOutput = extractNodeOutput as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockCharacterDefinitions.length = 0
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — scene node
// ---------------------------------------------------------------------------

// Phase 1B.2 pipeline-managed SceneNode — outputs are AssetRefs populated by the
// pipeline orchestrator in Phase 1C. resolveNodeInputs routes by source-handle kind:
//   - no/default handle → composite_video → routed like a video source
//   - "last_frame"       → last_frame      → routed like an image source
//   - "audio_track"      → scene_audio_track → routed like an audio source
// The legacy buildScenePrompt + generatedResults/generatedImageUrl/character-ref
// collection has been removed (Phase 1B.2). Production code no longer imports
// buildScenePrompt.
describe("resolveNodeInputs — scene node source", () => {
  it("routes composite_video output to videoUrl on a default-handle edge", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene.mp4")

    const sceneNode = makeNode("s1", "scene", {
      composite_video: { url: "http://scene.mp4", type: "video" },
    })
    const target = makeNode("t1", "trim-video")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.videoUrl).toBe("http://scene.mp4")
  })

  it("aggregates composite_video outputs into videoUrls for combine-videos targets", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene.mp4")

    const sceneNode = makeNode("s1", "scene", {
      composite_video: { url: "http://scene.mp4", type: "video" },
    })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.videoUrls).toContain("http://scene.mp4")
  })

  it("routes last_frame to referenceImageUrls when target is generate-image", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene-last.png")

    const sceneNode = makeNode("s1", "scene", {
      last_frame: { url: "http://scene-last.png", type: "image" },
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("s1", "t1", "last_frame")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://scene-last.png")
  })

  it("routes last_frame to imageUrl when target is not an image-merger", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene-last.png")

    const sceneNode = makeNode("s1", "scene", {
      last_frame: { url: "http://scene-last.png", type: "image" },
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("s1", "t1", "last_frame")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.imageUrl).toBe("http://scene-last.png")
  })

  it("routes last_frame to imageUrl for generate-video target (unified node)", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene-last.png")

    const sceneNode = makeNode("s1", "scene", {
      last_frame: { url: "http://scene-last.png", type: "image" },
    })
    const target = makeNode("t1", "generate-video")
    const edges = [makeEdge("s1", "t1", "last_frame")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.imageUrl).toBe("http://scene-last.png")
  })

  it("routes audio_track to audioUrl when target is a single-audio consumer", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene.mp3")

    const sceneNode = makeNode("s1", "scene", {
      scene_audio_track: { url: "http://scene.mp3", type: "audio" },
    })
    const target = makeNode("t1", "lip-sync")
    const edges = [makeEdge("s1", "t1", "audio_track")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.audioUrl).toBe("http://scene.mp3")
  })

  it("routes audio_track to audioSources for merge-video-audio targets", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene.mp3")

    const sceneNode = makeNode("s1", "scene", {
      scene_audio_track: { url: "http://scene.mp3", type: "audio" },
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("s1", "t1", "audio_track")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.audioSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "http://scene.mp3", sourceNodeId: "s1" }),
      ]),
    )
  })

  it("does not call buildScenePrompt — the legacy prompt path is gone", () => {
    mockExtractNodeOutput.mockReturnValue("http://scene.mp4")

    const sceneNode = makeNode("s1", "scene", {
      composite_video: { url: "http://scene.mp4", type: "video" },
    })
    const target = makeNode("t1", "trim-video")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(mockBuildScenePrompt).not.toHaveBeenCalled()
    expect(inputs.prompt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — adjust-volume
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — adjust-volume source", () => {
  it("sets videoUrl when lastInputType is video", () => {
    mockExtractNodeOutput.mockReturnValue("http://adjusted-video.mp4")

    const adjustNode = makeNode("av1", "adjust-volume", {
      lastInputType: "video",
      generatedResults: [
        { url: "http://adjusted-video.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "resize-video")
    const edges = [makeEdge("av1", "t1")]

    const inputs = resolveNodeInputs(target, [adjustNode, target], edges)
    expect(inputs.videoUrl).toBe("http://adjusted-video.mp4")
  })

  it("pushes to audioUrls when lastInputType is audio and target is mix-audio", () => {
    mockExtractNodeOutput.mockReturnValue("http://adjusted-audio.mp3")

    const adjustNode = makeNode("av1", "adjust-volume", {
      lastInputType: "audio",
      generatedResults: [
        { url: "http://adjusted-audio.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "mix-audio")
    const edges = [makeEdge("av1", "t1")]

    const inputs = resolveNodeInputs(target, [adjustNode, target], edges)
    expect(inputs.audioUrls).toContain("http://adjusted-audio.mp3")
    expect(inputs.audioUrlsWithSourceIds).toEqual([
      { nodeId: "av1", url: "http://adjusted-audio.mp3" },
    ])
  })

  it("pushes to audioSources when lastInputType is audio and target is merge-video-audio", () => {
    mockExtractNodeOutput.mockReturnValue("http://adjusted-audio.mp3")

    const adjustNode = makeNode("av1", "adjust-volume", {
      lastInputType: "audio",
      generatedResults: [
        { url: "http://adjusted-audio.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("av1", "t1")]

    const inputs = resolveNodeInputs(target, [adjustNode, target], edges)
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://adjusted-audio.mp3")
  })

  it("defaults lastInputType to audio and sets audioUrl for generic target", () => {
    mockExtractNodeOutput.mockReturnValue("http://adjusted.mp3")

    const adjustNode = makeNode("av1", "adjust-volume", {
      // No lastInputType specified, defaults to "audio"
      generatedResults: [
        { url: "http://adjusted.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "lip-sync")
    const edges = [makeEdge("av1", "t1")]

    const inputs = resolveNodeInputs(target, [adjustNode, target], edges)
    expect(inputs.audioUrl).toBe("http://adjusted.mp3")
    expect(inputs.videoUrl).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — suno-* types
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — suno source types", () => {
  it("sets audioUrl from suno-generate and extracts sunoTrackId + sunoTaskId", () => {
    mockExtractNodeOutput.mockReturnValue("http://suno-track.mp3")

    const sunoNode = makeNode("sg1", "suno-generate", {
      generatedResults: [
        { url: "http://suno-track.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
      sunoTrackId: "track-abc",
      sunoTaskId: "task-xyz",
    })
    const target = makeNode("t1", "suno-extend")
    const edges = [makeEdge("sg1", "t1")]

    const inputs = resolveNodeInputs(target, [sunoNode, target], edges)
    expect(inputs.audioUrl).toBe("http://suno-track.mp3")
    expect(inputs.sunoTrackId).toBe("track-abc")
    expect(inputs.sunoTaskId).toBe("task-xyz")
  })

  it("sets audioUrl from suno-cover source", () => {
    mockExtractNodeOutput.mockReturnValue("http://suno-cover.mp3")

    const sunoCover = makeNode("sc1", "suno-cover", {
      generatedResults: [
        { url: "http://suno-cover.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
      sunoTrackId: "cover-track-id",
    })
    const target = makeNode("t1", "lip-sync")
    const edges = [makeEdge("sc1", "t1")]

    const inputs = resolveNodeInputs(target, [sunoCover, target], edges)
    expect(inputs.audioUrl).toBe("http://suno-cover.mp3")
    expect(inputs.sunoTrackId).toBe("cover-track-id")
  })

  it("sets audioUrl from suno-extend and pushes to audioUrls for mix-audio target", () => {
    mockExtractNodeOutput.mockReturnValue("http://suno-extended.mp3")

    const sunoExtend = makeNode("se1", "suno-extend", {
      generatedResults: [
        { url: "http://suno-extended.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
      sunoTaskId: "extend-task-id",
    })
    const target = makeNode("t1", "mix-audio")
    const edges = [makeEdge("se1", "t1")]

    const inputs = resolveNodeInputs(target, [sunoExtend, target], edges)
    expect(inputs.audioUrls).toContain("http://suno-extended.mp3")
    expect(inputs.sunoTaskId).toBe("extend-task-id")
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — youtube-video to suno-cover
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — youtube-video to suno-cover", () => {
  it("sets uploadUrl to downloadedAudioUrl from youtube-video data", () => {
    mockExtractNodeOutput.mockReturnValue("http://yt-video.mp4")

    const ytNode = makeNode("yt1", "youtube-video", {
      downloadedVideoUrl: "http://yt-video.mp4",
      downloadedAudioUrl: "http://yt-audio.mp3",
    })
    const target = makeNode("t1", "suno-cover")
    const edges = [makeEdge("yt1", "t1")]

    const inputs = resolveNodeInputs(target, [ytNode, target], edges)
    expect(inputs.uploadUrl).toBe("http://yt-audio.mp3")
  })

  it("falls back to output when downloadedAudioUrl is not present", () => {
    mockExtractNodeOutput.mockReturnValue("http://yt-video.mp4")

    const ytNode = makeNode("yt1", "youtube-video", {
      downloadedVideoUrl: "http://yt-video.mp4",
    })
    const target = makeNode("t1", "suno-cover")
    const edges = [makeEdge("yt1", "t1")]

    const inputs = resolveNodeInputs(target, [ytNode, target], edges)
    expect(inputs.uploadUrl).toBe("http://yt-video.mp4")
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — upload-video/youtube-video to combine-videos
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — video sources to combine-videos", () => {
  it("pushes upload-video to videoUrls and videoUrlsWithSourceIds", () => {
    mockExtractNodeOutput.mockReturnValue("http://v1.mp4")

    const vid = makeNode("v1", "upload-video", { url: "http://v1.mp4" })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("v1", "t1")]

    const inputs = resolveNodeInputs(target, [vid, target], edges)
    expect(inputs.videoUrls).toEqual(["http://v1.mp4"])
    expect(inputs.videoUrlsWithSourceIds).toEqual([
      { nodeId: "v1", url: "http://v1.mp4" },
    ])
  })

  it("pushes youtube-video to videoUrls for combine-videos", () => {
    mockExtractNodeOutput.mockReturnValue("http://yt-downloaded.mp4")

    const ytNode = makeNode("yt1", "youtube-video", {
      downloadedVideoUrl: "http://yt-downloaded.mp4",
    })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("yt1", "t1")]

    const inputs = resolveNodeInputs(target, [ytNode, target], edges)
    expect(inputs.videoUrls).toEqual(["http://yt-downloaded.mp4"])
    expect(inputs.videoUrlsWithSourceIds).toEqual([
      { nodeId: "yt1", url: "http://yt-downloaded.mp4" },
    ])
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — upload-video to merge-video-audio
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — upload-video to merge-video-audio", () => {
  it("first upload-video sets videoUrl", () => {
    mockExtractNodeOutput.mockReturnValue("http://vid.mp4")

    const vid = makeNode("v1", "upload-video", { url: "http://vid.mp4" })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("v1", "t1")]

    const inputs = resolveNodeInputs(target, [vid, target], edges)
    expect(inputs.videoUrl).toBe("http://vid.mp4")
    expect(inputs.audioSources).toBeUndefined()
  })

  it("additional upload-video goes to audioSources with sourceType video", () => {
    mockExtractNodeOutput
      .mockReturnValueOnce("http://vid1.mp4")
      .mockReturnValueOnce("http://vid2.mp4")

    const vid1 = makeNode("v1", "upload-video", { url: "http://vid1.mp4" })
    const vid2 = makeNode("v2", "upload-video", { url: "http://vid2.mp4" })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("v1", "t1"), makeEdge("v2", "t1")]

    const inputs = resolveNodeInputs(target, [vid1, vid2, target], edges)
    expect(inputs.videoUrl).toBe("http://vid1.mp4")
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0]).toEqual({
      url: "http://vid2.mp4",
      sourceNodeId: "v2",
      sourceType: "video",
    })
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — audio types to merge-video-audio
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — audio types to merge-video-audio", () => {
  it("text-to-speech goes to audioSources for merge-video-audio", () => {
    mockExtractNodeOutput.mockReturnValue("http://tts.mp3")

    const ttsNode = makeNode("tts1", "text-to-speech", {
      generatedResults: [
        { url: "http://tts.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("tts1", "t1")]

    const inputs = resolveNodeInputs(target, [ttsNode, target], edges)
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://tts.mp3")
    expect(inputs.audioSources![0].sourceNodeId).toBe("tts1")
  })

  it("generate-music goes to audioSources for merge-video-audio", () => {
    mockExtractNodeOutput.mockReturnValue("http://music.mp3")

    const musicNode = makeNode("m1", "generate-music", {
      generatedResults: [
        { url: "http://music.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("m1", "t1")]

    const inputs = resolveNodeInputs(target, [musicNode, target], edges)
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://music.mp3")
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — upload-audio to mix-audio
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — upload-audio to mix-audio", () => {
  it("pushes to audioUrls and audioUrlsWithSourceIds", () => {
    mockExtractNodeOutput.mockReturnValue("http://uploaded.mp3")

    const audioNode = makeNode("a1", "upload-audio", {
      r2Url: "http://uploaded.mp3",
    })
    const target = makeNode("t1", "mix-audio")
    const edges = [makeEdge("a1", "t1")]

    const inputs = resolveNodeInputs(target, [audioNode, target], edges)
    expect(inputs.audioUrls).toEqual(["http://uploaded.mp3"])
    expect(inputs.audioUrlsWithSourceIds).toEqual([
      { nodeId: "a1", url: "http://uploaded.mp3" },
    ])
  })

  it("accumulates multiple upload-audio sources", () => {
    mockExtractNodeOutput
      .mockReturnValueOnce("http://a1.mp3")
      .mockReturnValueOnce("http://a2.mp3")

    const audio1 = makeNode("a1", "upload-audio", { r2Url: "http://a1.mp3" })
    const audio2 = makeNode("a2", "upload-audio", { r2Url: "http://a2.mp3" })
    const target = makeNode("t1", "mix-audio")
    const edges = [makeEdge("a1", "t1"), makeEdge("a2", "t1")]

    const inputs = resolveNodeInputs(target, [audio1, audio2, target], edges)
    expect(inputs.audioUrls).toEqual(["http://a1.mp3", "http://a2.mp3"])
    expect(inputs.audioUrlsWithSourceIds).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — transcribe/suno-lyrics/image-to-text as prompt
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — text output sources as prompt", () => {
  it("transcribe output sets prompt", () => {
    mockExtractNodeOutput.mockReturnValue("transcribed speech text")

    const transcribe = makeNode("tr1", "transcribe", {
      generatedResults: [{ text: "transcribed speech text" }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("tr1", "t1")]

    const inputs = resolveNodeInputs(target, [transcribe, target], edges)
    expect(inputs.prompt).toBe("transcribed speech text")
  })

  it("suno-lyrics output sets prompt", () => {
    mockExtractNodeOutput.mockReturnValue("verse 1 lyrics here")

    const lyrics = makeNode("sl1", "suno-lyrics", {
      generatedText: "verse 1 lyrics here",
    })
    const target = makeNode("t1", "text-to-speech")
    const edges = [makeEdge("sl1", "t1")]

    const inputs = resolveNodeInputs(target, [lyrics, target], edges)
    expect(inputs.prompt).toBe("verse 1 lyrics here")
  })

  it("image-to-text output sets prompt", () => {
    mockExtractNodeOutput.mockReturnValue("a photo of a cat sitting on a couch")

    const i2t = makeNode("it1", "image-to-text", {
      generatedResults: [{ text: "a photo of a cat sitting on a couch" }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("it1", "t1")]

    const inputs = resolveNodeInputs(target, [i2t, target], edges)
    expect(inputs.prompt).toBe("a photo of a cat sitting on a couch")
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — ai-writer/combine-text/split-text as prompt
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — ai-writer/combine-text/split-text as prompt", () => {
  it("ai-writer generatedText sets prompt", () => {
    mockExtractNodeOutput.mockReturnValue("AI generated story text")

    const writer = makeNode("w1", "ai-writer", {
      generatedText: "AI generated story text",
    })
    const target = makeNode("t1", "text-to-speech")
    const edges = [makeEdge("w1", "t1")]

    const inputs = resolveNodeInputs(target, [writer, target], edges)
    expect(inputs.prompt).toBe("AI generated story text")
  })

  it("combine-text combinedText sets prompt", () => {
    mockExtractNodeOutput.mockReturnValue("combined text output")

    const combiner = makeNode("ct1", "combine-text", {
      combinedText: "combined text output",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("ct1", "t1")]

    const inputs = resolveNodeInputs(target, [combiner, target], edges)
    expect(inputs.prompt).toBe("combined text output")
  })

  it("split-text output sets prompt", () => {
    mockExtractNodeOutput.mockReturnValue("first split segment")

    const splitter = makeNode("st1", "split-text", {
      splitResults: ["first split segment", "second split segment"],
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("st1", "t1")]

    const inputs = resolveNodeInputs(target, [splitter, target], edges)
    expect(inputs.prompt).toBe("first split segment")
  })
})

// ---------------------------------------------------------------------------
// extractNodeOutputAsList
// ---------------------------------------------------------------------------

describe("extractNodeOutputAsList", () => {
  it("returns splitResults array for split-text node", () => {
    const node = makeNode("st1", "split-text", {
      splitResults: ["line one", "line two", "line three"],
    })

    const result = extractNodeOutputAsList(node)
    expect(result).toEqual(["line one", "line two", "line three"])
  })

  it("returns undefined for split-text with empty splitResults", () => {
    const node = makeNode("st1", "split-text", { splitResults: [] })

    const result = extractNodeOutputAsList(node)
    expect(result).toBeUndefined()
  })

  it("splits list node items by newlines and trims", () => {
    const node = makeNode("l1", "list", {
      items: "  apple  \nbanana\n  cherry  \n",
    })

    const result = extractNodeOutputAsList(node)
    expect(result).toEqual(["apple", "banana", "cherry"])
  })

  it("returns undefined for list node with empty items", () => {
    const node = makeNode("l1", "list", { items: "" })

    const result = extractNodeOutputAsList(node)
    expect(result).toBeUndefined()
  })

  it("returns __listResults array when present on data", () => {
    const node = makeNode("x1", "generate-image", {
      __listResults: ["result-a", "result-b"],
    })

    const result = extractNodeOutputAsList(node)
    expect(result).toEqual(["result-a", "result-b"])
  })

  it("falls back to extractNodeOutput wrapped in array", () => {
    mockExtractNodeOutput.mockReturnValue("single-output")

    const node = makeNode("g1", "generate-image", {
      generatedResults: [
        { url: "single-output", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })

    const result = extractNodeOutputAsList(node)
    expect(result).toEqual(["single-output"])
  })

  it("returns undefined when extractNodeOutput returns nothing", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const node = makeNode("g1", "generate-image", {})

    const result = extractNodeOutputAsList(node)
    expect(result).toBeUndefined()
  })

  it("returns undefined when __listResults is empty and no generatedResults", () => {
    mockExtractNodeOutput.mockReturnValue("fallback-value")

    const node = makeNode("g1", "generate-image", { __listResults: [] })

    const result = extractNodeOutputAsList(node)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getListInputForNode
// ---------------------------------------------------------------------------

describe("getListInputForNode", () => {
  it("returns split text lines from upstream of a list node", () => {
    mockExtractNodeOutput.mockReturnValue("line1\nline2\nline3")

    const textNode = makeNode("t1", "text-prompt", { text: "line1\nline2\nline3" })
    const listNode = makeNode("list1", "list", { columns: [], rows: [] })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "list1", undefined, "in"),
      makeEdge("list1", "gen1"),
    ]

    const result = getListInputForNode(target, [textNode, listNode, target], edges)
    expect(result).toEqual(["line1", "line2", "line3"])
  })

  it("reads column data from list node rows at matching column index", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const listNode = makeNode("list1", "list", {
      columns: [
        { handleId: "col-0", name: "Prompt" },
        { handleId: "col-1", name: "Style" },
      ],
      rows: [
        ["prompt A", "style X"],
        ["prompt B", "style Y"],
        ["prompt C", "style Z"],
      ],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("list1", "gen1", "col-0")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toEqual(["prompt A", "prompt B", "prompt C"])
  })

  it("reads second column data when sourceHandle matches col-1", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const listNode = makeNode("list1", "list", {
      columns: [
        { handleId: "col-0", name: "Prompt" },
        { handleId: "col-1", name: "Style" },
      ],
      rows: [
        ["prompt A", "style X"],
        ["prompt B", "style Y"],
      ],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("list1", "gen1", "col-1")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toEqual(["style X", "style Y"])
  })

  it("returns list output from a source with more than 1 item", () => {
    // Use a split-text node which produces a list via extractNodeOutputAsList
    const splitNode = makeNode("sp1", "split-text", {
      splitResults: ["item1", "item2", "item3"],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("sp1", "gen1")]

    const result = getListInputForNode(target, [splitNode, target], edges)
    expect(result).toEqual(["item1", "item2", "item3"])
  })

  it("returns undefined when no list sources are connected", () => {
    mockExtractNodeOutput.mockReturnValue("single-value")

    const textNode = makeNode("t1", "text-prompt", { text: "single-value" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("t1", "gen1")]

    const result = getListInputForNode(target, [textNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("returns undefined when list upstream produces only one line", () => {
    mockExtractNodeOutput.mockReturnValue("only one line")

    const textNode = makeNode("t1", "text-prompt", { text: "only one line" })
    const listNode = makeNode("list1", "list", { columns: [], rows: [] })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "list1", undefined, "in"),
      makeEdge("list1", "gen1"),
    ]

    const result = getListInputForNode(target, [textNode, listNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("returns undefined when list has only one row in column data", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const listNode = makeNode("list1", "list", {
      columns: [{ handleId: "col-0", name: "Prompt" }],
      rows: [["only one row"]],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("list1", "gen1", "col-0")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("splits upstream text by column splitDelimiter instead of newline", () => {
    mockExtractNodeOutput.mockReturnValue("alpha,beta,gamma")

    const textNode = makeNode("t1", "text-prompt", { text: "alpha,beta,gamma" })
    const listNode = makeNode("list1", "list", {
      columns: [{ handleId: "col-0", name: "Prompt", type: "text", splitDelimiter: "," }],
      rows: [],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "list1", undefined, "in"),
      makeEdge("list1", "gen1", "col-0"),
    ]

    const result = getListInputForNode(target, [textNode, listNode, target], edges)
    expect(result).toEqual(["alpha", "beta", "gamma"])
  })

  it("falls back to newline when no splitDelimiter set", () => {
    mockExtractNodeOutput.mockReturnValue("line1\nline2")

    const textNode = makeNode("t1", "text-prompt", { text: "line1\nline2" })
    const listNode = makeNode("list1", "list", {
      columns: [{ handleId: "col-0", name: "Prompt", type: "text" }],
      rows: [],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "list1", undefined, "in"),
      makeEdge("list1", "gen1", "col-0"),
    ]

    const result = getListInputForNode(target, [textNode, listNode, target], edges)
    expect(result).toEqual(["line1", "line2"])
  })

  it("uses pipe delimiter to split upstream text", () => {
    mockExtractNodeOutput.mockReturnValue("one|two|three|four")

    const textNode = makeNode("t1", "text-prompt", { text: "one|two|three|four" })
    const listNode = makeNode("list1", "list", {
      columns: [{ handleId: "col-0", name: "Items", type: "text", splitDelimiter: "|" }],
      rows: [],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "list1", undefined, "in"),
      makeEdge("list1", "gen1", "col-0"),
    ]

    const result = getListInputForNode(target, [textNode, listNode, target], edges)
    expect(result).toEqual(["one", "two", "three", "four"])
  })

  it("ignores edges on the 'variables' target handle (no fan-out from a variable source)", () => {
    // A 3-item list connected to filter-list's main `in` would normally
    // fan out. On the `variables` handle it must not — that handle feeds
    // condition refs only.
    const listNode = makeNode("l1", "list", {
      columns: [{ handleId: "col-0", name: "Col", type: "text" }],
      rows: [["a"], ["b"], ["c"]],
    })
    const target = makeNode("f1", "filter-list")
    const edges = [makeEdge("l1", "f1", "col-0", "variables")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Edge output mode routing
// ---------------------------------------------------------------------------

function makeEdgeWithData(
  source: string,
  target: string,
  data: Record<string, unknown>,
  sourceHandle?: string,
): any {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    targetHandle: undefined,
    data,
  }
}

describe("getListInputForNode — edge output mode", () => {
  it("fans out when list edge mode is 'each' (default)", () => {
    const listNode = makeNode("l1", "list", {
      columns: [{ id: "default", name: "Items", handleId: "col_default", type: "text" }],
      rows: [["a"], ["b"], ["c"]],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("l1", "gen1", "col_default")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toEqual(["a", "b", "c"])
  })

  it("fans out when list edge mode is explicitly 'each'", () => {
    const listNode = makeNode("l1", "list", {
      columns: [{ id: "default", name: "Items", handleId: "col_default", type: "text" }],
      rows: [["a"], ["b"], ["c"]],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "each" }, "col_default")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toEqual(["a", "b", "c"])
  })

  it("does NOT fan out when edge mode is 'last'", () => {
    const listNode = makeNode("l1", "list", { items: "a\nb\nc" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "last" })]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("does NOT fan out when edge mode is 'all'", () => {
    const listNode = makeNode("l1", "list", { items: "a\nb\nc" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "all" })]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("does NOT fan out when edge mode is 'item:1'", () => {
    const listNode = makeNode("l1", "list", { items: "a\nb\nc" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "item:1" })]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getListInputForNode — fan-in early-return (mirrors backend FAN_IN_NODE_TYPES)
// ---------------------------------------------------------------------------

describe("getListInputForNode — fan-in nodes (reduce)", () => {
  it("returns undefined when target node is 'reduce', even with upstream list", () => {
    // Wire List → Reduce directly. Without the early-return, executeNodeForList
    // would fan out the reduce node N times (one per list item), each call
    // hitting POST /v1/reduce and charging credits — the credit-leak bug
    // that the symmetric backend guard prevents.
    const listNode = makeNode("l1", "list", {
      columns: [{ id: "default", name: "Items", handleId: "col_default", type: "text" }],
      rows: [["a"], ["b"], ["c"]],
    })
    const target = makeNode("c1", "reduce")
    const edges = [makeEdge("l1", "c1", "col_default")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toBeUndefined()
  })
})

describe("resolveNodeInputs — list edge output mode routing", () => {
  it("uses first item for default 'each' mode (fan-out handles rest)", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("l1", "gen1")]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("apple")
  })

  it("uses last item when edge mode is 'last'", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "last" })]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("cherry")
  })

  it("joins all items when edge mode is 'all'", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "all" })]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("apple, banana, cherry")
  })

  it("uses specific item when edge mode is 'item:N' (0-indexed)", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "item:1" })]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("banana")
  })

  it("uses item:0 for first item", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "item:0" })]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("apple")
  })

  it("uses item:2 for third item", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "item:2" })]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("cherry")
  })

  it("falls back to first item when item index is out of range", () => {
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.type === "list") return "apple"
      return undefined
    })
    const listNode = makeNode("l1", "list", { items: "apple\nbanana\ncherry" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "item:10" })]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("apple")
  })

  it("routes list's image-url column to referenceImageUrls on generate-image (regression: was landing in prompt)", () => {
    // List with a typed image-url column feeding generate-image as reference.
    // Before the fix, the list branch used text-only routing (inputs.prompt),
    // which starved inputs.referenceImageUrls. Downstream execute-node.ts
    // then fell back to collectAncestorRefs, which walks raw upstream and
    // ignores edge filters — so the gen-image pulled an unfiltered image
    // from the original source instead of the filtered list value.
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: [{ url: "http://img/a.png" }, { url: "http://img/b.png" }],
      generatedImageUrl: "http://img/a.png",
    })
    const listNode = makeNode("l1", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "image-url" }],
      rows: [],
    })
    const target = makeNode("gen2", "generate-image")
    const edges = [
      {
        id: "img1->l1",
        source: "img1",
        target: "l1",
        sourceHandle: "image",
        targetHandle: "col_c1_in",
        data: { outputMode: "all" },
      },
      {
        id: "l1->gen2",
        source: "l1",
        target: "gen2",
        sourceHandle: "col_c1",
        targetHandle: "in",
        data: { outputMode: "each" },
      },
    ]

    const inputs = resolveNodeInputs(target, [imgNode, listNode, target], edges as any)
    expect(inputs.referenceImageUrls).toBeDefined()
    expect(inputs.referenceImageUrls?.length).toBeGreaterThan(0)
    expect(inputs.prompt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// list per-column connected source
// ---------------------------------------------------------------------------

describe("list per-column connected source", () => {
  it("resolves connected column data from upstream node via col_*_in edges", () => {
    const listNode = makeNode("list1", "list", {
      columns: [
        { id: "c1", name: "Prompt", handleId: "col_c1", type: "text", connectedSourceId: "text1" },
      ],
      rows: [["manual data"]],
    })
    const textNode = makeNode("text1", "text-prompt", { text: "upstream value" })
    const imgNode = makeNode("img1", "generate-image", {})

    const nodes = [textNode, imgNode, listNode]
    const edges = [
      makeEdge("text1", "list1", undefined, "col_c1_in"),
      makeEdge("list1", "img1", "col_c1", undefined),
    ]

    mockExtractNodeOutput.mockImplementation((node: any, sourceHandle?: string) => {
      if (node.id === "text1") return "upstream value"
      // Loop node returns first row for the matched column (real extractNodeOutput behaviour)
      if (node.id === "list1" && sourceHandle === "col_c1") return "manual data"
      return undefined
    })

    const result = resolveNodeInputs(imgNode, nodes, edges)
    expect(result.prompt).toBe("upstream value")
  })

  it("falls back to manual rows when no per-column edge exists", () => {
    const listNode = makeNode("list1", "list", {
      columns: [
        { id: "c1", name: "Prompt", handleId: "col_c1", type: "text" },
      ],
      rows: [["manual value"]],
    })
    const imgNode = makeNode("img1", "generate-image", {})

    const nodes = [imgNode, listNode]
    const edges = [
      makeEdge("list1", "img1", "col_c1", undefined),
    ]

    mockExtractNodeOutput.mockImplementation((node: any, sourceHandle?: string) => {
      if (node.id === "list1" && sourceHandle === "col_c1") return "manual value"
      return undefined
    })

    const result = resolveNodeInputs(imgNode, nodes, edges)
    expect(result.prompt).toBe("manual value")
  })
})
