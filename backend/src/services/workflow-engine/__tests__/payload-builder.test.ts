import { describe, it, expect } from "vitest"
import { buildPayload, buildNodeRefMap } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }
}

// ---------------------------------------------------------------------------
// buildPayload
// ---------------------------------------------------------------------------

describe("buildPayload", () => {
  const jobId = "job-1"
  const usageLogId = "usage-1"

  // --- Image generation ---
  describe("generate-image", () => {
    it("builds payload with default provider", () => {
      const n = node("n1", "generate-image", { prompt: "a cat" })
      const result = buildPayload(n, jobId, {}, usageLogId)
      expect(result.jobName).toBe("generate-image")
      expect(result.queueName).toBe("video-generation")
      expect(result.payload.jobId).toBe(jobId)
      expect(result.payload.prompt).toBe("a cat")
      expect(result.payload.provider).toBe("nano-banana")
      expect(result.payload.usageLogId).toBe(usageLogId)
    })

    it("uses resolved prompt over node data", () => {
      const n = node("n1", "generate-image", { prompt: "old" })
      const inputs: ResolvedInputs = { prompt: "new from upstream" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.prompt).toBe("new from upstream")
    })

    it("passes aspect ratio and seed", () => {
      const n = node("n1", "generate-image", {
        prompt: "test",
        aspectRatio: "16:9",
        seed: 12345,
        provider: "flux",
      })
      const result = buildPayload(n, jobId, {})
      expect(result.payload.aspectRatio).toBe("16:9")
      expect(result.payload.seed).toBe(12345)
      expect(result.payload.provider).toBe("flux")
    })

    it("includes referenceImageUrls from resolved inputs", () => {
      const n = node("n1", "generate-image", { prompt: "test" })
      const inputs: ResolvedInputs = {
        referenceImageUrls: ["https://ref1.png", "https://ref2.png"],
      }
      const result = buildPayload(n, jobId, inputs)
      expect((result.payload.referenceImageUrls as string[]).length).toBeGreaterThanOrEqual(2)
    })
  })

  // --- Edit image ---
  describe("edit-image", () => {
    it("builds payload with default provider", () => {
      const n = node("n1", "edit-image", { prompt: "remove bg", imageUrl: "https://img.png" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("edit-image")
      expect(result.payload.provider).toBe("recraft-upscale")
      expect(result.payload.imageUrl).toBe("https://img.png")
    })

    it("uses resolvedInputs.imageUrl over node data", () => {
      const n = node("n1", "edit-image", { imageUrl: "old.png" })
      const result = buildPayload(n, jobId, { imageUrl: "new.png" })
      expect(result.payload.imageUrl).toBe("new.png")
    })
  })

  // --- Video generation ---
  describe("image-to-video", () => {
    it("builds payload", () => {
      const n = node("n1", "image-to-video", { provider: "kling", duration: 5 })
      const inputs: ResolvedInputs = { imageUrl: "https://img.png" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("image-to-video")
      expect(result.payload.imageUrl).toBe("https://img.png")
      expect(result.payload.duration).toBe(5)
      expect(result.payload.provider).toBe("kling")
    })

    it("uses startFrameUrl from resolved inputs", () => {
      const n = node("n1", "image-to-video", { provider: "minimax" })
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://start.png",
        endFrameUrl: "https://end.png",
      }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.imageUrl).toBe("https://start.png")
      expect(result.payload.endFrameUrl).toBe("https://end.png")
    })
  })

  describe("text-to-video", () => {
    it("builds payload", () => {
      const n = node("n1", "text-to-video", { provider: "kling", prompt: "a sunset" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.prompt).toBe("a sunset")
    })
  })

  describe("video-to-video", () => {
    it("builds payload", () => {
      const n = node("n1", "video-to-video", { provider: "wan" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4", prompt: "make it anime" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("video-to-video")
      expect(result.payload.videoUrl).toBe("https://v.mp4")
      expect(result.payload.prompt).toBe("make it anime")
    })
  })

  // --- Audio ---
  describe("text-to-speech", () => {
    it("builds payload with default provider", () => {
      const n = node("n1", "text-to-speech", { text: "Hello world", voice: "adam" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("text-to-speech")
      expect(result.payload.text).toBe("Hello world")
      expect(result.payload.provider).toBe("elevenlabs-v3")
    })

    it("uses resolved prompt", () => {
      const n = node("n1", "text-to-speech", { text: "old" })
      const result = buildPayload(n, jobId, { prompt: "from upstream" })
      expect(result.payload.text).toBe("from upstream")
    })

    it("reads directText when textSource is direct", () => {
      const n = node("n1", "text-to-speech", { textSource: "direct", directText: "direct text" })
      const result = buildPayload(n, jobId, {})
      expect(result.payload.text).toBe("direct text")
    })
  })

  describe("generate-music", () => {
    it("builds payload", () => {
      const n = node("n1", "generate-music", { prompt: "epic score", provider: "musicgen" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("generate-music")
      expect(result.modelIdentifier).toBe("generate-music")
      expect(result.payload.prompt).toBe("epic score")
    })
  })

  describe("text-to-audio", () => {
    it("builds payload", () => {
      const n = node("n1", "text-to-audio", { prompt: "thunder" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("text-to-audio")
      expect(result.modelIdentifier).toBe("elevenlabs-sfx")
    })
  })

  // --- FFmpeg nodes ---
  describe("FFmpeg nodes", () => {
    it("combine-videos", () => {
      const n = node("n1", "combine-videos", {})
      const inputs: ResolvedInputs = { videoUrls: ["https://v1.mp4", "https://v2.mp4"] }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("combine-videos")
      expect(result.queueName).toBe("video-generation")
      expect(result.payload.videoUrls).toEqual(["https://v1.mp4", "https://v2.mp4"])
      expect(result.payload.transition).toBe("cut")
    })

    it("merge-video-audio builds audioTracks", () => {
      const n = node("n1", "merge-video-audio", {})
      const inputs: ResolvedInputs = {
        videoUrl: "https://v.mp4",
        audioSources: [{ url: "https://a.mp3", sourceNodeId: "a1" }],
      }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("merge-video-audio")
      expect(result.payload.videoUrl).toBe("https://v.mp4")
      const tracks = result.payload.audioTracks as Array<Record<string, unknown>>
      expect(tracks).toHaveLength(1)
      expect(tracks[0].url).toBe("https://a.mp3")
    })

    it("trim-video", () => {
      const n = node("n1", "trim-video", { startTime: 5, endTime: 10 })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("trim-video")
      expect(result.payload.startTime).toBe(5)
      expect(result.payload.endTime).toBe(10)
    })

    it("resize-video", () => {
      const n = node("n1", "resize-video", { targetAspect: "9:16" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("resize-video")
      expect(result.payload.targetAspect).toBe("9:16")
    })

    it("speed-ramp", () => {
      const n = node("n1", "speed-ramp", { speed: 2 })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("speed-ramp")
      expect(result.payload.speed).toBe(2)
    })

    it("loop-video", () => {
      const n = node("n1", "loop-video", { repeatCount: 3 })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("loop-video")
      expect(result.payload.repeatCount).toBe(3)
      expect(result.payload.mode).toBe("repeat")
    })

    it("fade-video", () => {
      const n = node("n1", "fade-video", {})
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("fade-video")
      expect(result.payload.fadeIn).toBe(true)
      expect(result.payload.fadeOut).toBe(true)
    })

    it("transcode-video", () => {
      const n = node("n1", "transcode-video", { codec: "h265" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("transcode-video")
      expect(result.payload.codec).toBe("h265")
    })

    it("add-captions", () => {
      const n = node("n1", "add-captions", { captions: "hello" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("add-captions")
      expect(result.payload.text).toBe("hello")
    })

    it("mix-audio", () => {
      const n = node("n1", "mix-audio", {})
      const inputs: ResolvedInputs = { audioUrls: ["https://a1.mp3", "https://a2.mp3"] }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("mix-audio")
      expect(result.payload.audioUrls).toEqual(["https://a1.mp3", "https://a2.mp3"])
    })

    it("adjust-volume", () => {
      const n = node("n1", "adjust-volume", { volume: 50 })
      const inputs: ResolvedInputs = { audioUrl: "https://a.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("adjust-volume")
      expect(result.payload.volume).toBe(50)
    })

    it("trim-audio", () => {
      const n = node("n1", "trim-audio", { startTime: 0, endTime: 30 })
      const inputs: ResolvedInputs = { audioUrl: "https://a.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("trim-audio")
    })
  })

  // --- Entity nodes ---
  describe("entity nodes", () => {
    for (const entityType of ["character", "face", "object", "location"]) {
      it(`builds ${entityType} payload`, () => {
        const n = node("n1", entityType, { description: `a ${entityType}`, provider: "flux" })
        const result = buildPayload(n, jobId, {})
        expect(result.jobName).toBe(`generate-${entityType}`)
        expect(result.payload.prompt).toBe(`a ${entityType}`)
        expect(result.payload.provider).toBe("flux")
      })
    }
  })

  // --- Suno ---
  describe("suno nodes", () => {
    it("suno-generate", () => {
      const n = node("n1", "suno-generate", { prompt: "pop song" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("suno-generate")
      expect(result.modelIdentifier).toBe("suno-generate")
    })

    it("suno-generate V5 model", () => {
      const n = node("n1", "suno-generate", { prompt: "pop", model: "V5" })
      const result = buildPayload(n, jobId, {})
      expect(result.modelIdentifier).toBe("suno-v5")
    })

    it("suno-cover", () => {
      const n = node("n1", "suno-cover", {})
      const inputs: ResolvedInputs = { audioUrl: "https://cover.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("suno-cover")
      expect(result.payload.uploadUrl).toBe("https://cover.mp3")
    })

    it("suno-extend", () => {
      const n = node("n1", "suno-extend", { sunoTrackId: "track-1" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("suno-extend")
      expect(result.payload.audioId).toBe("track-1")
    })

    it("suno-lyrics", () => {
      const n = node("n1", "suno-lyrics", { prompt: "write lyrics" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("suno-lyrics")
    })

    it("suno-separate", () => {
      const n = node("n1", "suno-separate", { sunoTaskId: "task-1", type: "separate_vocal" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("suno-separate")
      expect(result.payload.type).toBe("separate_vocal")
    })

    it("suno-mashup", () => {
      const n = node("n1", "suno-mashup", {})
      const inputs: ResolvedInputs = { audioUrl: "a.mp3", audioUrl2: "b.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("suno-mashup")
      const urlList = result.payload.uploadUrlList as string[]
      expect(urlList).toContain("a.mp3")
      expect(urlList).toContain("b.mp3")
    })
  })

  // --- Other nodes ---
  describe("other nodes", () => {
    it("lip-sync", () => {
      const n = node("n1", "lip-sync", { provider: "kling-avatar" })
      const inputs: ResolvedInputs = { imageUrl: "https://face.png", audioUrl: "https://a.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("lip-sync")
      expect(result.payload.imageUrl).toBe("https://face.png")
      expect(result.payload.audioUrl).toBe("https://a.mp3")
    })

    it("speech-to-video", () => {
      const n = node("n1", "speech-to-video", { resolution: "720p" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("speech-to-video")
      expect(result.modelIdentifier).toBe("speech-to-video:720p")
    })

    it("speech-to-video default resolution", () => {
      const n = node("n1", "speech-to-video", {})
      const result = buildPayload(n, jobId, {})
      expect(result.modelIdentifier).toBe("speech-to-video")
    })

    it("video-upscale", () => {
      const n = node("n1", "video-upscale", { provider: "topaz" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("video-upscale")
      expect(result.modelIdentifier).toBe("topaz-video")
    })

    it("extend-video", () => {
      const n = node("n1", "extend-video", { provider: "veo-extend", model: "fast" })
      const inputs: ResolvedInputs = { kieTaskId: "task-1" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("extend-video")
      expect(result.payload.kieTaskId).toBe("task-1")
      expect(result.payload.model).toBe("fast")
    })

    it("sora-character", () => {
      const n = node("n1", "sora-character", { mode: "standard", characterPrompt: "warrior" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("sora-character")
      expect(result.modelIdentifier).toBe("sora-character")
    })

    it("transcribe", () => {
      const n = node("n1", "transcribe", { provider: "elevenlabs-stt" })
      const inputs: ResolvedInputs = { audioUrl: "https://audio.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("transcribe")
      expect(result.payload.audioUrl).toBe("https://audio.mp3")
    })

    it("audio-isolation", () => {
      const n = node("n1", "audio-isolation", {})
      const inputs: ResolvedInputs = { audioUrl: "https://a.mp3" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("audio-isolation")
      expect(result.modelIdentifier).toBe("elevenlabs-isolation")
    })

    it("voice-changer", () => {
      const n = node("n1", "voice-changer", { voiceId: "v1" })
      const result = buildPayload(n, jobId, { audioUrl: "a.mp3" })
      expect(result.jobName).toBe("voice-changer")
      expect(result.payload.voiceId).toBe("v1")
    })

    it("dubbing", () => {
      const n = node("n1", "dubbing", { targetLanguage: "es" })
      const result = buildPayload(n, jobId, { audioUrl: "a.mp3" })
      expect(result.jobName).toBe("dubbing")
      expect(result.payload.targetLanguage).toBe("es")
    })

    it("voice-remix", () => {
      const n = node("n1", "voice-remix", { voiceDescription: "deep voice" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("voice-remix")
    })

    it("voice-design", () => {
      const n = node("n1", "voice-design", { voiceDescription: "warm tone" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("voice-design")
      expect(result.modelIdentifier).toBe("elevenlabs-voice-design")
    })

    it("forced-alignment", () => {
      const n = node("n1", "forced-alignment", { transcript: "hello" })
      const result = buildPayload(n, jobId, { audioUrl: "a.mp3" })
      expect(result.jobName).toBe("forced-alignment")
    })

    it("generate-script", () => {
      const n = node("n1", "generate-script", { prompt: "movie script", sceneCount: 5 })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("generate-script")
      expect(result.payload.sceneCount).toBe(5)
    })

    it("render-video goes to video-render queue", () => {
      const n = node("n1", "render-video", { planType: "scene-graph" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("render-video")
      expect(result.queueName).toBe("video-render")
      expect(result.modelIdentifier).toBe("render-video")
    })
  })

  // --- Error handling ---
  it("throws for unknown node type", () => {
    const n = node("n1", "totally-unknown-type", {})
    expect(() => buildPayload(n, jobId, {})).toThrow("Unknown node type")
  })
})

// ---------------------------------------------------------------------------
// buildNodeRefMap
// ---------------------------------------------------------------------------

describe("buildNodeRefMap", () => {
  it("returns empty map with no context", () => {
    const result = buildNodeRefMap("n1")
    expect(result.size).toBe(0)
  })

  it("maps parent node label to its text output", () => {
    const parent = node("p", "text-prompt", { text: "hello", label: "My Prompt" })
    const child = node("c", "generate-image")
    const result = buildNodeRefMap("c", {
      nodes: [parent, child],
      edges: [edge("p", "c")],
      nodeStates: { p: { status: "completed", output: { text: "hello" } } },
    })
    expect(result.get("My Prompt")).toBe("hello")
  })

  it("traverses multiple levels of parents", () => {
    const grandparent = node("gp", "text-prompt", { text: "gp text", label: "GP" })
    const parent = node("p", "text-prompt", { text: "p text", label: "Parent" })
    const child = node("c", "generate-image")
    const result = buildNodeRefMap("c", {
      nodes: [grandparent, parent, child],
      edges: [edge("gp", "p"), edge("p", "c")],
      nodeStates: {
        gp: { status: "completed", output: { text: "gp text" } },
        p: { status: "completed", output: { text: "p text" } },
      },
    })
    expect(result.get("GP")).toBe("gp text")
    expect(result.get("Parent")).toBe("p text")
  })

  it("uses node type as label when label is missing", () => {
    const parent = node("p", "text-prompt", { text: "hello" })
    const child = node("c", "generate-image")
    const result = buildNodeRefMap("c", {
      nodes: [parent, child],
      edges: [edge("p", "c")],
      nodeStates: { p: { status: "completed", output: { text: "hello" } } },
    })
    expect(result.get("text-prompt")).toBe("hello")
  })

  it("resolves list node with outputMode 'last'", () => {
    const listNode = node("l", "list", { items: "a\nb\nc", label: "My List" })
    const child = node("c", "generate-image")
    const result = buildNodeRefMap("c", {
      nodes: [listNode, child],
      edges: [{ id: "e1", source: "l", target: "c", sourceHandle: null, targetHandle: null, data: { outputMode: "last" } }],
      nodeStates: {},
    })
    expect(result.get("My List")).toBe("c")
  })

  it("resolves list node with outputMode 'all'", () => {
    const listNode = node("l", "list", { items: "a\nb\nc", label: "My List" })
    const child = node("c", "generate-image")
    const result = buildNodeRefMap("c", {
      nodes: [listNode, child],
      edges: [{ id: "e1", source: "l", target: "c", sourceHandle: null, targetHandle: null, data: { outputMode: "all" } }],
      nodeStates: {},
    })
    expect(result.get("My List")).toBe("a, b, c")
  })

  it("falls back to saved node output", () => {
    const parent = node("p", "generate-image", { generatedImageUrl: "saved.png", label: "Image" })
    const child = node("c", "image-to-video")
    const result = buildNodeRefMap("c", {
      nodes: [parent, child],
      edges: [edge("p", "c")],
      nodeStates: {},
    })
    expect(result.get("Image")).toBe("saved.png")
  })
})
