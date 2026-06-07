import { describe, it, expect } from "vitest"
import { buildPayload, buildNodeRefMap, expandWiredLocationRefs } from "../payload-builder.js"
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

    it("prefers the typed node prompt over a wired input (typed-primary)", () => {
      const n = node("n1", "generate-image", { prompt: "typed wins" })
      const inputs: ResolvedInputs = { prompt: "new from upstream" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.prompt).toBe("typed wins")
    })

    it("falls back to the wired input when the typed prompt is empty", () => {
      const n = node("n1", "generate-image", { prompt: "" })
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

    // Drag-to-reorder in the config panel writes `connectedRefImageOrder` to
    // node data. The orchestrator must re-derive `referenceImageUrls` in that
    // order before mention-merge so positional Image-N letters in the
    // assembled prompt match the user's intended ordering. Verified by:
    // (a) passing two character upstreams (edge order kira → mike),
    // (b) setting connectedRefImageOrder=[mike,kira] (reversed),
    // (c) asserting the payload's referenceImageUrls comes out mike-first.
    it("applies connectedRefImageOrder to referenceImageUrls (image-to-video)", () => {
      const consumer = node("v1", "image-to-video", {
        provider: "grok-i2v",
        duration: 5,
        connectedRefImageOrder: ["mike", "kira"],
      })
      const kira = node("kira", "character", {})
      const mike = node("mike", "character", {})
      const states: Record<string, NodeExecutionState> = {
        kira: { status: "completed", output: { imageUrl: "https://kira.png" } },
        mike: { status: "completed", output: { imageUrl: "https://mike.png" } },
      }
      const edges: SimpleEdge[] = [
        edge("kira", "v1", "characterRef", "references"),
        edge("mike", "v1", "characterRef", "references"),
      ]
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://start.png",
        referenceImageUrls: ["https://kira.png", "https://mike.png"],
      }
      const result = buildPayload(consumer, jobId, inputs, undefined, {
        nodes: [consumer, kira, mike],
        edges,
        nodeStates: states,
      })
      const refs = result.payload.referenceImageUrls as string[]
      expect(refs[0]).toBe("https://mike.png")
      expect(refs[1]).toBe("https://kira.png")
    })

    it("falls back to edge order when connectedRefImageOrder is empty", () => {
      const consumer = node("v1", "image-to-video", {
        provider: "grok-i2v",
        duration: 5,
      })
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://start.png",
        referenceImageUrls: ["https://a.png", "https://b.png"],
      }
      const result = buildPayload(consumer, jobId, inputs)
      const refs = result.payload.referenceImageUrls as string[]
      expect(refs[0]).toBe("https://a.png")
      expect(refs[1]).toBe("https://b.png")
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

  // The unified generate-video node dispatches `jobName` dynamically at
  // payload-build time based on the wiring shape. The downstream worker
  // handlers + credit pricing key off the chosen `jobName`, so we verify
  // both the mode-dispatch decision AND the payload shape passed through.
  describe("generate-video", () => {
    // 1. Pure text-only → `text-to-video` worker route + TEXT_2_VIDEO veo hint.
    it("text-only mode → jobName text-to-video + TEXT_2_VIDEO generationType", () => {
      const n = node("n1", "generate-video", { provider: "kling", prompt: "a dog" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.prompt).toBe("a dog")
      expect(result.payload.imageUrl).toBeUndefined()
      expect(result.payload.generationType).toBe("TEXT_2_VIDEO")
    })

    // 2. startFrame wired → `image-to-video` route + i2v credit identifier.
    //    `buildVideoCreditModelIdentifier(...mode=image-to-video...)` mints a
    //    Kling-i2v identifier; we only assert the provider name is present
    //    rather than pinning the exact composite string (the helper has its
    //    own coverage and changes shape across providers).
    it("startFrame connected → jobName image-to-video + i2v credit identifier", () => {
      const n = node("n1", "generate-video", { provider: "kling", duration: 5 })
      const inputs: ResolvedInputs = { startFrameUrl: "https://cdn/frame.png" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("image-to-video")
      expect(result.payload.imageUrl).toBe("https://cdn/frame.png")
      expect(result.modelIdentifier).toMatch(/kling/)
    })

    // 3. Both frames wired → VEO-style first-and-last-frames generation hint.
    it("startFrame + endFrame → FIRST_AND_LAST_FRAMES_2_VIDEO", () => {
      const n = node("n1", "generate-video", { provider: "veo3" })
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://cdn/a.png",
        endFrameUrl: "https://cdn/b.png",
      }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.generationType).toBe("FIRST_AND_LAST_FRAMES_2_VIDEO")
      expect(result.payload.imageUrl).toBe("https://cdn/a.png")
      expect(result.payload.endFrameUrl).toBe("https://cdn/b.png")
    })

    // 4. endFrame wired but no startFrame — providers like veo3/minimax need
    //    at least one image to anchor i2v, so endFrame is swapped into the
    //    primary `imageUrl` slot and `endFrameUrl` is cleared (we'd otherwise
    //    repeat the same image, confusing the worker).
    it("endFrame only (no startFrame) → swap endFrame into imageUrl, leave endFrameUrl undefined", () => {
      const n = node("n1", "generate-video", { provider: "veo3" })
      const inputs: ResolvedInputs = { endFrameUrl: "https://cdn/only.png" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.imageUrl).toBe("https://cdn/only.png")
      expect(result.payload.endFrameUrl).toBeUndefined()
    })

    // 5. Reference images only (no startFrame) → REFERENCE_2_VIDEO hint + the
    //    worker route stays on `text-to-video` (no primary image input, refs
    //    are conditioning only).
    it("imageReferences only → REFERENCE_2_VIDEO + jobName text-to-video (no image input)", () => {
      const n = node("n1", "generate-video", { provider: "seedance-2-fast" })
      const inputs: ResolvedInputs = { referenceImageUrls: ["https://cdn/r1.png"] }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.generationType).toBe("REFERENCE_2_VIDEO")
      expect(result.payload.referenceImageUrls).toEqual(["https://cdn/r1.png"])
      expect(result.payload.imageUrl).toBeUndefined()
    })

    // 6. Pre-merge audio handle → `audioUrl` flows through to the worker so
    //    the post-process step can merge it into the rendered clip.
    it("audio handle → audioUrl in payload (post-merge)", () => {
      const n = node("n1", "generate-video", { provider: "kling" })
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://cdn/f.png",
        audioUrl: "https://cdn/a.mp3",
      }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.audioUrl).toBe("https://cdn/a.mp3")
    })

    // 7. Seedance-2 audio conditioning refs flow through as
    //    `referenceAudioUrls` (separate from the post-merge `audioUrl`).
    it("audioReferences → referenceAudioUrls in payload (S2 conditioning)", () => {
      const n = node("n1", "generate-video", { provider: "seedance-2-fast" })
      const inputs: ResolvedInputs = { referenceAudioUrls: ["https://cdn/cond.wav"] }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.referenceAudioUrls).toEqual(["https://cdn/cond.wav"])
    })

    // 8. The `negative` typed handle is resolved (in input-resolver) into
    //    `resolvedInputs.negativePrompt`. It MUST take precedence over the
    //    config-panel `data.negativePrompt` field, with that field as the
    //    fallback — mirrors how `prompt` already works.
    it("negative handle text reaches payload.negativePrompt", () => {
      const n = node("n1", "generate-video", { provider: "kling", negativePrompt: "fallback" })
      const inputs: ResolvedInputs = { negativePrompt: "blurry, low quality" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.negativePrompt).toBe("blurry, low quality")
    })

    // 9. Kling 3.0 mode/sound field-name desync (final-review finding):
    //    the generate-video widget writes to the legacy `kling3Mode` /
    //    `kling3Sound` field names. The payload-builder must accept those as
    //    fallbacks for the canonical `mode`/`sound` so a fresh generate-video
    //    node + Kling 3.0 doesn't silently drop the user's settings.
    //    Mirrors the i2v case's existing legacy fallback chain.
    it("generate-video falls back to legacy kling3Mode/kling3Sound field names", () => {
      const n = node("n1", "generate-video", {
        provider: "kling-3.0",
        kling3Mode: "pro",
        kling3Sound: true,
      })
      const inputs: ResolvedInputs = { startFrameUrl: "https://cdn/f.png" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.mode).toBe("pro")
      expect(result.payload.sound).toBe(true)
    })

    // 10. Split-id models (Grok Imagine 1, Wan 2.6/2.7) show as ONE picker row
    //     keyed by the base (i2v) id, but KIE keys i2v and t2v off different ids
    //     in different maps. The orchestrator MUST remap base→mode id so BOTH the
    //     worker model lookup (payload.provider) AND the credit identifier match
    //     the chosen mode. Mirrors the frontend executor.
    it("Grok base (grok-i2v) + no image → t2v id 'grok'", () => {
      const n = node("n1", "generate-video", { provider: "grok-i2v", prompt: "a fox" })
      const result = buildPayload(n, jobId, {})
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.provider).toBe("grok") // worker → grok-imagine/text-to-video
      // Billing: T2V_CREDIT_OVERRIDES maps t2v 'grok' → the grok-i2v rate
      // (20 KIE cr), NOT the 4cr image grok. The remap (→'grok') and the override
      // compose correctly.
      expect(result.modelIdentifier.startsWith("grok-i2v")).toBe(true)
    })

    it("Grok base (grok-i2v) + start frame → i2v id 'grok-i2v'", () => {
      const n = node("n1", "generate-video", { provider: "grok-i2v" })
      const result = buildPayload(n, jobId, { startFrameUrl: "https://cdn/f.png" })
      expect(result.jobName).toBe("image-to-video")
      expect(result.payload.provider).toBe("grok-i2v")
      expect(result.modelIdentifier.startsWith("grok-i2v")).toBe(true)
    })

    it("legacy t2v twin 'grok' + start frame → remaps to i2v 'grok-i2v' (footgun fix)", () => {
      // Picking the t2v 'grok' and connecting an image used to send 'grok' to the
      // i2v worker where KIE_VIDEO_MODELS['grok'] is undefined → crash.
      const n = node("n1", "generate-video", { provider: "grok" })
      const result = buildPayload(n, jobId, { startFrameUrl: "https://cdn/f.png" })
      expect(result.jobName).toBe("image-to-video")
      expect(result.payload.provider).toBe("grok-i2v")
    })

    it("Wan 2.6 base (wan-i2v) remaps by mode", () => {
      const t2v = buildPayload(node("n1", "generate-video", { provider: "wan-i2v", prompt: "x" }), jobId, {})
      expect(t2v.payload.provider).toBe("wan")
      const i2v = buildPayload(node("n2", "generate-video", { provider: "wan-i2v" }), jobId, { startFrameUrl: "https://cdn/f.png" })
      expect(i2v.payload.provider).toBe("wan-i2v")
    })

    it("Wan 2.7 base (wan-2.7-i2v) remaps by mode", () => {
      const t2v = buildPayload(node("n1", "generate-video", { provider: "wan-2.7-i2v", prompt: "x" }), jobId, {})
      expect(t2v.payload.provider).toBe("wan-2.7-t2v")
      const i2v = buildPayload(node("n2", "generate-video", { provider: "wan-2.7-i2v" }), jobId, { startFrameUrl: "https://cdn/f.png" })
      expect(i2v.payload.provider).toBe("wan-2.7-i2v")
    })

    it("non-split-id providers are unaffected by the remap (kling)", () => {
      const t2v = buildPayload(node("n1", "generate-video", { provider: "kling", prompt: "x" }), jobId, {})
      expect(t2v.payload.provider).toBe("kling")
      const i2v = buildPayload(node("n2", "generate-video", { provider: "kling" }), jobId, { startFrameUrl: "https://cdn/f.png" })
      expect(i2v.payload.provider).toBe("kling")
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

    it("forwards wan-videoedit params", () => {
      const n = node("n1", "video-to-video", {
        provider: "wan-videoedit",
        negativePrompt: "no blur",
        videoEditDuration: "5",
        audioSetting: "origin",
        promptExtend: true,
      })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4", prompt: "edit this" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.provider).toBe("wan-videoedit")
      expect(result.payload.negativePrompt).toBe("no blur")
      expect(result.payload.videoEditDuration).toBe("5")
      expect(result.payload.audioSetting).toBe("origin")
      expect(result.payload.promptExtend).toBe(true)
    })
  })

  // --- Audio ---
  describe("text-to-speech", () => {
    it("builds payload with default provider", () => {
      // directText (gated by textSource) is the real TTS text field; `data.text`
      // is a phantom that the unified prompt helper intentionally ignores.
      const n = node("n1", "text-to-speech", { textSource: "direct", directText: "Hello world", voice: "adam" })
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

    it("add-captions forwards data.text as payload.text (static path)", () => {
      const n = node("n1", "add-captions", { text: "hello" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("add-captions")
      expect(result.payload.text).toBe("hello")
      expect(result.payload.captions).toBeUndefined()
    })

    it("add-captions forwards structured captions[] as payload.captions (kinetic path)", () => {
      const captionsArr = [
        { text: "hi", startMs: 0, endMs: 500, timestampMs: 0, confidence: null },
        { text: "world", startMs: 500, endMs: 1000, timestampMs: 500, confidence: null },
      ]
      const n = node("n1", "add-captions", { captions: captionsArr, style: "tiktok-words" })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.jobName).toBe("add-captions")
      // structured captions[] flow: payload.captions is the array, payload.text is undefined
      expect(result.payload.captions).toEqual(captionsArr)
      expect(result.payload.text).toBeUndefined()
      expect(result.payload.style).toBe("tiktok-words")
    })

    it("add-captions forwards auto_transcribe + transcribe_provider", () => {
      const n = node("n1", "add-captions", {
        auto_transcribe: true,
        transcribe_provider: "whisper",
        style: "word-pop",
      })
      const inputs: ResolvedInputs = { videoUrl: "https://v.mp4" }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.auto_transcribe).toBe(true)
      expect(result.payload.transcribe_provider).toBe("whisper")
      expect(result.payload.style).toBe("word-pop")
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

// ---------------------------------------------------------------------------
// Phase 2 #3: expandWiredLocationRefs emits one ConnectedReference per
// user-uploaded reference photo, carrying the photo's `kind` so the prompt
// builder can annotate the subject line at generate time. These auto-attach
// (unlike per-variant entries which are mention-only) — the
// connectedReferences filter at prompt-builder.ts:1011-1016 keeps them because
// they have `locationReferencePhotoKind` set but `locationVariantBucket`
// unset.
// ---------------------------------------------------------------------------

describe("expandWiredLocationRefs — reference photos (Phase 2 #3)", () => {
  function locationNode(id: string, extra: Record<string, unknown> = {}): SimpleNode {
    return node(id, "location", {
      label: "Old Library",
      locationName: "Old Library",
      sourceImageUrl: "https://r2/old-library.png",
      description: "Stately library at dusk",
      canonicalDescription: "A dimly-lit Victorian library with leather-bound books",
      ...extra,
    })
  }

  it("returns only the canonical entry when referencePhotos is empty", () => {
    const loc = locationNode("loc-1", { referencePhotos: [] })
    const consumer = node("gen-1", "generate-image")
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    expect(refs).toHaveLength(1)
    expect(refs[0].id).toBe("loc-1")
    expect(refs[0].locationReferencePhotoKind).toBeUndefined()
  })

  it("emits canonical + N entries when N reference photos are present", () => {
    const loc = locationNode("loc-1", {
      referencePhotos: [
        { kind: "wide", url: "https://r2/wide.png" },
        { kind: "interior", url: "https://r2/interior.png" },
        { kind: "moodBoard", url: "https://r2/mood.png" },
      ],
    })
    const consumer = node("gen-1", "generate-image")
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    // 1 canonical + 3 reference photos.
    expect(refs).toHaveLength(4)

    const photoRefs = refs.filter((r) => r.locationReferencePhotoKind !== undefined)
    expect(photoRefs).toHaveLength(3)

    const wide = photoRefs.find((r) => r.locationReferencePhotoKind === "wide")
    expect(wide).toBeDefined()
    expect(wide!.id).toBe("loc-1_refphoto_wide_0")
    expect(wide!.url).toBe("https://r2/wide.png")
    expect(wide!.defaultName).toBe("Old Library (wide-angle reference)")
    expect(wide!.source).toBe("wired-location")

    const interior = photoRefs.find((r) => r.locationReferencePhotoKind === "interior")
    expect(interior).toBeDefined()
    expect(interior!.id).toBe("loc-1_refphoto_interior_1")
    expect(interior!.defaultName).toBe("Old Library (interior reference)")

    const mood = photoRefs.find((r) => r.locationReferencePhotoKind === "moodBoard")
    expect(mood).toBeDefined()
    expect(mood!.id).toBe("loc-1_refphoto_moodBoard_2")
    expect(mood!.defaultName).toBe("Old Library (mood-board reference)")
  })

  it("skips reference photos with empty URLs", () => {
    const loc = locationNode("loc-1", {
      referencePhotos: [
        { kind: "wide", url: "" },
        { kind: "interior", url: "   " },
        { kind: "detail", url: "https://r2/detail.png" },
      ],
    })
    const consumer = node("gen-1", "generate-image")
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    // 1 canonical + 1 valid detail entry; the empty URLs are dropped.
    expect(refs).toHaveLength(2)
    const photoRefs = refs.filter((r) => r.locationReferencePhotoKind !== undefined)
    expect(photoRefs).toHaveLength(1)
    expect(photoRefs[0].locationReferencePhotoKind).toBe("detail")
    expect(photoRefs[0].url).toBe("https://r2/detail.png")
  })

  it("skips reference photos with unknown/invalid kinds", () => {
    const loc = locationNode("loc-1", {
      referencePhotos: [
        { kind: "wide", url: "https://r2/wide.png" },
        { kind: "garbage", url: "https://r2/garbage.png" },
        { kind: "", url: "https://r2/empty-kind.png" },
      ],
    })
    const consumer = node("gen-1", "generate-image")
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    // Canonical + 1 valid wide; "garbage" and "" are dropped.
    expect(refs).toHaveLength(2)
    const photoRefs = refs.filter((r) => r.locationReferencePhotoKind !== undefined)
    expect(photoRefs).toHaveLength(1)
    expect(photoRefs[0].locationReferencePhotoKind).toBe("wide")
  })

  it("propagates locationSlug and locationCanonicalDescription onto each reference-photo entry", () => {
    const loc = locationNode("loc-1", {
      referencePhotos: [
        { kind: "wide", url: "https://r2/wide.png" },
        { kind: "exterior", url: "https://r2/exterior.png" },
      ],
    })
    const consumer = node("gen-1", "generate-image")
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const photoRefs = refs.filter((r) => r.locationReferencePhotoKind !== undefined)
    expect(photoRefs).toHaveLength(2)
    for (const r of photoRefs) {
      expect(r.locationSlug).toBe("old-library")
      expect(r.locationCanonicalDescription).toBe(
        "A dimly-lit Victorian library with leather-bound books",
      )
      // Reference-photo entries MUST leave locationVariantBucket unset so the
      // connectedReferences filter at prompt-builder.ts:1011-1016 keeps them
      // (the filter drops entries with locationVariantBucket set, but
      // reference photos auto-attach — they're not gated by @-mention).
      expect(r.locationVariantBucket).toBeUndefined()
    }
  })
})

// Phase 2 #1 — Smart variant selection. When the consumer's prompt
// contains a keyword that matches one of the location's variants AND
// the user hasn't explicitly overridden via `selectedVariant`, the
// canonical entry's URL gets swapped to the matching variant.
describe("expandWiredLocationRefs — smart variant selection (Phase 2 #1)", () => {
  const buildLocation = (extra: Record<string, unknown> = {}) =>
    node("loc-1", "location", {
      sourceImageUrl: "https://r2/canonical.png",
      locationName: "Old Library",
      timeOfDay: [
        { name: "night", url: "https://r2/night.png" },
        { name: "dusk", url: "https://r2/dusk.png" },
      ],
      weather: [{ name: "rain", url: "https://r2/rain.png" }],
      ...extra,
    })

  it("swaps canonical URL when the prompt contains a matching variant name", () => {
    const loc = buildLocation()
    const consumer = node("gen-1", "generate-image", {
      prompt: "Hero stands in the library at night, dramatic.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/night.png")
  })

  it("matches via synonyms (sunset → dusk)", () => {
    const loc = buildLocation()
    const consumer = node("gen-1", "generate-image", {
      prompt: "Hero stands in the library at sunset, golden light.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/dusk.png")
  })

  it("matches weather variants (rainy → rain)", () => {
    const loc = buildLocation()
    const consumer = node("gen-1", "generate-image", {
      prompt: "A rainy evening in the library.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/rain.png")
  })

  it("uses word boundaries so substring noise doesn't match (drain ≠ rain)", () => {
    const loc = buildLocation()
    const consumer = node("gen-1", "generate-image", {
      prompt: "Hero refuses to drain the moat.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/canonical.png")
  })

  it("falls through to canonical when no keyword matches", () => {
    const loc = buildLocation()
    const consumer = node("gen-1", "generate-image", {
      prompt: "Hero walks down the corridor.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/canonical.png")
  })

  it("explicit selectedVariant (Phase 2 #4) wins over smart match", () => {
    // selectedVariant is applied by the orchestrator BEFORE
    // expandWiredLocationRefs runs (it patches sourceImageUrl). We test
    // here that the smart matcher is SKIPPED when selectedVariant is
    // present — even if the prompt also has a different keyword.
    const loc = buildLocation({
      // selectedVariant present → the orchestrator would have already
      // patched sourceImageUrl to the variant's URL. The smart matcher
      // must NOT override it again.
      selectedVariant: "weather/rain",
      sourceImageUrl: "https://r2/rain.png", // mimics orchestrator patch
    })
    const consumer = node("gen-1", "generate-image", {
      // Prompt also mentions "night" — smart matcher could pick night,
      // but selectedVariant takes precedence.
      prompt: "Hero stands in the library at night.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/rain.png")
  })

  it("falls back to motionPrompt when consumer has no prompt field", () => {
    const loc = buildLocation()
    const consumer = node("gen-1", "image-to-video", {
      motionPrompt: "Slow dolly through the library at dusk.",
    })
    const refs = expandWiredLocationRefs("gen-1", {
      nodes: [loc, consumer],
      edges: [edge("loc-1", "gen-1")],
      nodeStates: {},
    })
    const canonical = refs.find((r) => r.id === "loc-1")
    expect(canonical?.url).toBe("https://r2/dusk.png")
  })
})
