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

describe("resolveNodeInputs — scene node source", () => {
  it("calls buildScenePrompt with sceneData and characterDefinitions", () => {
    mockBuildScenePrompt.mockReturnValue("A dramatic scene in the desert")
    mockExtractNodeOutput.mockReturnValue("http://scene-img.png")

    const sceneNode = makeNode("s1", "scene", {
      characters: [{ assetId: "char1" }],
      locations: [],
      objects: [],
      generatedImageUrl: "http://scene-img.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("s1", "t1")]

    resolveNodeInputs(target, [sceneNode, target], edges)
    expect(mockBuildScenePrompt).toHaveBeenCalledWith(
      sceneNode.data,
      mockCharacterDefinitions,
    )
  })

  it("sets prompt from buildScenePrompt result", () => {
    mockBuildScenePrompt.mockReturnValue("cinematic desert landscape")
    mockExtractNodeOutput.mockReturnValue("http://scene-img.png")

    const sceneNode = makeNode("s1", "scene", {
      characters: [],
      locations: [],
      objects: [],
      generatedImageUrl: "http://scene-img.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.prompt).toBe("cinematic desert landscape")
  })

  it("extracts imageUrl from generatedResults at activeResultIndex", () => {
    mockBuildScenePrompt.mockReturnValue("prompt")
    mockExtractNodeOutput.mockReturnValue("http://scene-result.png")

    const sceneNode = makeNode("s1", "scene", {
      characters: [],
      locations: [],
      objects: [],
      generatedResults: [
        { url: "http://scene-r0.png", timestamp: "t0", jobId: "j0" },
        { url: "http://scene-r1.png", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 1,
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.imageUrl).toBe("http://scene-r1.png")
  })

  it("falls back to generatedImageUrl when no generatedResults", () => {
    mockBuildScenePrompt.mockReturnValue("prompt")
    mockExtractNodeOutput.mockReturnValue("http://fallback.png")

    const sceneNode = makeNode("s1", "scene", {
      characters: [],
      locations: [],
      objects: [],
      generatedImageUrl: "http://fallback.png",
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.imageUrl).toBe("http://fallback.png")
  })

  it("sets referenceImageUrls when target is generate-image", () => {
    mockBuildScenePrompt.mockReturnValue("prompt")
    mockExtractNodeOutput.mockReturnValue("http://scene-img.png")

    const sceneNode = makeNode("s1", "scene", {
      characters: [],
      locations: [],
      objects: [],
      generatedImageUrl: "http://scene-img.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://scene-img.png")
  })

  it("collects reference images from character/location/object assets via characterDefinitions", () => {
    mockBuildScenePrompt.mockReturnValue("prompt")
    mockExtractNodeOutput.mockReturnValue("http://scene-img.png")

    mockCharacterDefinitions.push(
      { id: "char1", referenceImageUrl: "http://char1-ref.png" },
      { id: "loc1", referenceImageUrl: "http://loc1-ref.png" },
      { id: "obj1", referenceImageUrl: "http://obj1-ref.png" },
    )

    const sceneNode = makeNode("s1", "scene", {
      characters: [{ assetId: "char1" }],
      locations: [{ assetId: "loc1" }],
      objects: [{ assetId: "obj1" }],
      generatedImageUrl: "http://scene-img.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://char1-ref.png")
    expect(inputs.referenceImageUrls).toContain("http://loc1-ref.png")
    expect(inputs.referenceImageUrls).toContain("http://obj1-ref.png")
  })

  it("skips assets not found in characterDefinitions", () => {
    mockBuildScenePrompt.mockReturnValue("prompt")
    mockExtractNodeOutput.mockReturnValue("http://scene-img.png")

    // characterDefinitions is empty, so no asset matches
    const sceneNode = makeNode("s1", "scene", {
      characters: [{ assetId: "missing-char" }],
      locations: [],
      objects: [],
      generatedImageUrl: "http://scene-img.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("s1", "t1")]

    const inputs = resolveNodeInputs(target, [sceneNode, target], edges)
    // Only the scene image itself should be in referenceImageUrls, no asset refs
    expect(inputs.referenceImageUrls).toEqual(["http://scene-img.png"])
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

  it("ignores empty __listResults and falls back to extractNodeOutput", () => {
    mockExtractNodeOutput.mockReturnValue("fallback-value")

    const node = makeNode("g1", "generate-image", { __listResults: [] })

    const result = extractNodeOutputAsList(node)
    expect(result).toEqual(["fallback-value"])
  })
})

// ---------------------------------------------------------------------------
// getListInputForNode
// ---------------------------------------------------------------------------

describe("getListInputForNode", () => {
  it("returns split text lines from upstream of a loop node", () => {
    mockExtractNodeOutput.mockReturnValue("line1\nline2\nline3")

    const textNode = makeNode("t1", "text-prompt", { text: "line1\nline2\nline3" })
    const loopNode = makeNode("loop1", "loop", { columns: [], rows: [] })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "loop1", undefined, "in"),
      makeEdge("loop1", "gen1"),
    ]

    const result = getListInputForNode(target, [textNode, loopNode, target], edges)
    expect(result).toEqual(["line1", "line2", "line3"])
  })

  it("reads column data from loop node rows at matching column index", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const loopNode = makeNode("loop1", "loop", {
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
    const edges = [makeEdge("loop1", "gen1", "col-0")]

    const result = getListInputForNode(target, [loopNode, target], edges)
    expect(result).toEqual(["prompt A", "prompt B", "prompt C"])
  })

  it("reads second column data when sourceHandle matches col-1", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const loopNode = makeNode("loop1", "loop", {
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
    const edges = [makeEdge("loop1", "gen1", "col-1")]

    const result = getListInputForNode(target, [loopNode, target], edges)
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

  it("returns undefined when loop upstream produces only one line", () => {
    mockExtractNodeOutput.mockReturnValue("only one line")

    const textNode = makeNode("t1", "text-prompt", { text: "only one line" })
    const loopNode = makeNode("loop1", "loop", { columns: [], rows: [] })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "loop1", undefined, "in"),
      makeEdge("loop1", "gen1"),
    ]

    const result = getListInputForNode(target, [textNode, loopNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("returns undefined when loop has only one row in column data", () => {
    mockExtractNodeOutput.mockReturnValue(undefined)

    const loopNode = makeNode("loop1", "loop", {
      columns: [{ handleId: "col-0", name: "Prompt" }],
      rows: [["only one row"]],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("loop1", "gen1", "col-0")]

    const result = getListInputForNode(target, [loopNode, target], edges)
    expect(result).toBeUndefined()
  })

  it("splits upstream text by column splitDelimiter instead of newline", () => {
    mockExtractNodeOutput.mockReturnValue("alpha,beta,gamma")

    const textNode = makeNode("t1", "text-prompt", { text: "alpha,beta,gamma" })
    const loopNode = makeNode("loop1", "loop", {
      columns: [{ handleId: "col-0", name: "Prompt", type: "text", splitDelimiter: "," }],
      rows: [],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "loop1", undefined, "in"),
      makeEdge("loop1", "gen1", "col-0"),
    ]

    const result = getListInputForNode(target, [textNode, loopNode, target], edges)
    expect(result).toEqual(["alpha", "beta", "gamma"])
  })

  it("falls back to newline when no splitDelimiter set", () => {
    mockExtractNodeOutput.mockReturnValue("line1\nline2")

    const textNode = makeNode("t1", "text-prompt", { text: "line1\nline2" })
    const loopNode = makeNode("loop1", "loop", {
      columns: [{ handleId: "col-0", name: "Prompt", type: "text" }],
      rows: [],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "loop1", undefined, "in"),
      makeEdge("loop1", "gen1", "col-0"),
    ]

    const result = getListInputForNode(target, [textNode, loopNode, target], edges)
    expect(result).toEqual(["line1", "line2"])
  })

  it("uses pipe delimiter to split upstream text", () => {
    mockExtractNodeOutput.mockReturnValue("one|two|three|four")

    const textNode = makeNode("t1", "text-prompt", { text: "one|two|three|four" })
    const loopNode = makeNode("loop1", "loop", {
      columns: [{ handleId: "col-0", name: "Items", type: "text", splitDelimiter: "|" }],
      rows: [],
    })
    const target = makeNode("gen1", "generate-image")
    const edges = [
      makeEdge("t1", "loop1", undefined, "in"),
      makeEdge("loop1", "gen1", "col-0"),
    ]

    const result = getListInputForNode(target, [textNode, loopNode, target], edges)
    expect(result).toEqual(["one", "two", "three", "four"])
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
    const listNode = makeNode("l1", "list", { items: "a\nb\nc" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdge("l1", "gen1")]

    const result = getListInputForNode(target, [listNode, target], edges)
    expect(result).toEqual(["a", "b", "c"])
  })

  it("fans out when list edge mode is explicitly 'each'", () => {
    const listNode = makeNode("l1", "list", { items: "a\nb\nc" })
    const target = makeNode("gen1", "generate-image")
    const edges = [makeEdgeWithData("l1", "gen1", { outputMode: "each" })]

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
})

// ---------------------------------------------------------------------------
// extractNodeOutputAsList — useAllResults
// ---------------------------------------------------------------------------

describe("extractNodeOutputAsList — useAllResults", () => {
  it("returns generatedResults when useAllResults is true, even if __listResults exists", () => {
    const node = makeNode("img1", "generate-image", {
      __listResults: ["latest1.png", "latest2.png"],
      generatedResults: [
        { url: "old1.png" }, { url: "old2.png" }, { url: "latest1.png" }, { url: "latest2.png" },
      ],
    })
    const result = extractNodeOutputAsList(node, true)
    expect(result).toEqual(["old1.png", "old2.png", "latest1.png", "latest2.png"])
  })

  it("falls back to __listResults when generatedResults is empty and useAllResults is true", () => {
    const node = makeNode("img1", "generate-image", {
      __listResults: ["a.png", "b.png"],
      generatedResults: [],
    })
    const result = extractNodeOutputAsList(node, true)
    expect(result).toEqual(["a.png", "b.png"])
  })

  it("returns single generatedResult when useAllResults is true (no length > 1 guard)", () => {
    const node = makeNode("img1", "generate-image", {
      generatedResults: [{ url: "single.png" }],
    })
    const result = extractNodeOutputAsList(node, true)
    expect(result).toEqual(["single.png"])
  })

  it("uses __listResults when useAllResults is false (default)", () => {
    const node = makeNode("img1", "generate-image", {
      __listResults: ["latest.png"],
      generatedResults: [
        { url: "old.png" }, { url: "latest.png" },
      ],
    })
    const result = extractNodeOutputAsList(node, false)
    expect(result).toEqual(["latest.png"])
  })
})

// ---------------------------------------------------------------------------
// resolveNodeInputs — useAllResults on edge
// ---------------------------------------------------------------------------

describe("resolveNodeInputs — useAllResults on edge", () => {
  it("uses generatedResults when edge has useAllResults and mode is 'last'", () => {
    const imgNode = makeNode("img1", "generate-image", {
      __listResults: ["latest.png"],
      generatedResults: [{ url: "old.png" }, { url: "latest.png" }],
      generatedImageUrl: "latest.png",
    })
    ;(extractNodeOutput as ReturnType<typeof vi.fn>).mockReturnValue("latest.png")
    const target = makeNode("desc1", "image-to-video")
    const edges = [makeEdgeWithData("img1", "desc1", { outputMode: "last", useAllResults: true })]

    const inputs = resolveNodeInputs(target, [imgNode, target], edges)
    expect(inputs.imageUrl).toBe("latest.png")
  })

  it("joins all generatedResults when edge has useAllResults and mode is 'all'", () => {
    const imgNode = makeNode("img1", "generate-image", {
      __listResults: ["latest.png"],
      generatedResults: [{ url: "old.png" }, { url: "latest.png" }],
      generatedImageUrl: "old.png",
    })
    ;(extractNodeOutput as ReturnType<typeof vi.fn>).mockReturnValue("old.png")
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdgeWithData("img1", "t1", { outputMode: "all", useAllResults: true })]

    const inputs = resolveNodeInputs(target, [imgNode, target], edges)
    expect(inputs.imageUrl).toBe("old.png, latest.png")
  })
})

// ---------------------------------------------------------------------------
// getListInputForNode — useAllResults
// ---------------------------------------------------------------------------

describe("getListInputForNode — useAllResults", () => {
  it("fans out over generatedResults when edge has useAllResults and mode 'each'", () => {
    const imgNode = makeNode("img1", "generate-image", {
      __listResults: ["latest.png"],
      generatedResults: [{ url: "old.png" }, { url: "latest.png" }],
    })
    const target = makeNode("desc1", "image-to-text")
    const edges = [makeEdgeWithData("img1", "desc1", { outputMode: "each", useAllResults: true })]

    const result = getListInputForNode(target, [imgNode, target], edges)
    expect(result).toEqual(["old.png", "latest.png"])
  })

  it("does not fan out when useAllResults but mode is 'last'", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: [{ url: "a.png" }, { url: "b.png" }],
    })
    const target = makeNode("desc1", "image-to-text")
    const edges = [makeEdgeWithData("img1", "desc1", { outputMode: "last", useAllResults: true })]

    const result = getListInputForNode(target, [imgNode, target], edges)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// loop per-column connected source
// ---------------------------------------------------------------------------

describe("loop per-column connected source", () => {
  it("resolves connected column data from upstream node via col_*_in edges", () => {
    const loopNode = makeNode("loop1", "loop", {
      columns: [
        { id: "c1", name: "Prompt", handleId: "col_c1", type: "text", connectedSourceId: "text1" },
      ],
      rows: [["manual data"]],
    })
    const textNode = makeNode("text1", "text-prompt", { text: "upstream value" })
    const imgNode = makeNode("img1", "generate-image", {})

    const nodes = [textNode, imgNode, loopNode]
    const edges = [
      makeEdge("text1", "loop1", undefined, "col_c1_in"),
      makeEdge("loop1", "img1", "col_c1", undefined),
    ]

    mockExtractNodeOutput.mockImplementation((node: any, sourceHandle?: string) => {
      if (node.id === "text1") return "upstream value"
      // Loop node returns first row for the matched column (real extractNodeOutput behaviour)
      if (node.id === "loop1" && sourceHandle === "col_c1") return "manual data"
      return undefined
    })

    const result = resolveNodeInputs(imgNode, nodes, edges)
    expect(result.prompt).toBe("upstream value")
  })

  it("falls back to manual rows when no per-column edge exists", () => {
    const loopNode = makeNode("loop1", "loop", {
      columns: [
        { id: "c1", name: "Prompt", handleId: "col_c1", type: "text" },
      ],
      rows: [["manual value"]],
    })
    const imgNode = makeNode("img1", "generate-image", {})

    const nodes = [imgNode, loopNode]
    const edges = [
      makeEdge("loop1", "img1", "col_c1", undefined),
    ]

    mockExtractNodeOutput.mockImplementation((node: any, sourceHandle?: string) => {
      if (node.id === "loop1" && sourceHandle === "col_c1") return "manual value"
      return undefined
    })

    const result = resolveNodeInputs(imgNode, nodes, edges)
    expect(result.prompt).toBe("manual value")
  })
})
