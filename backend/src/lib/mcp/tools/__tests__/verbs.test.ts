import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerVerbs } from "../verbs.js"
import {
  LIP_SYNC_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS,
  VIDEO_ANALYSIS_TIER_ORDER,
  VIDEO_ANALYSIS_DURATION_BUCKETS,
  VIDEO_ANALYSIS_BUCKET_CREDITS,
  buildVideoAnalysisCreditId,
  resolveVideoAnalysisModel,
  getMaxTtsChars,
  DEFAULT_TTS_PROVIDER,
  buildLipSyncCreditId,
} from "@nodaro/shared"
import { newSession } from "../../session.js"
import { _resetRegistry } from "../../tasks.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools, executeSession, stubRoute } from "./_helpers.js"

const audio = vi.hoisted(() => ({ measured: vi.fn() }))
vi.mock("../_audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_audio-length.js")>()),
  measuredAudioSeconds: audio.measured,
}))

beforeEach(() => {
  _resetRegistry()
  // No test reaches the network: an unmeasured file reads as "could not be measured".
  audio.measured.mockReset().mockResolvedValue(undefined)
})

/**
 * v1.1 generation verbs.
 *
 * Tests run the SDK's tools/* request handlers in-process. Each verb gets:
 *  1. A success path that asserts `_meta.task_id` and route payload shape.
 *  2. An error path that asserts `isError: true` on a 400.
 *  3. A scope-gated path proving the verb is omitted from `tools/list` when
 *     `workflows:execute` is missing.
 *
 * The suite uses a stub fastify per test rather than a shared beforeEach so
 * each verb is independently auditable when one fails.
 */

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          // getUserMcpPreferences uses .single() — return empty so callers
          // fall through to catalog defaults.
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))


function readOnlySession() {
  return newSession({
    userId: "u1",
    scopes: ["jobs:read"] as Scope[],
    clientName: "Claude",
  })
}

describe("generate_image verb", () => {
  it("composes prompt + structured fields and calls /v1/generate-image", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-123" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", {
      prompt: "a knight",
      model: "nano-banana-2",
      structured: { mood: "epic" },
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-123")
    expect(received.body?.prompt).toBe("a knight Mood: epic.")
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
    // Per MCP Apps spec: tool returns text + structuredContent. The iframe
    // (registered at ui://nodaro/widget/job-image via tool _meta.ui.resourceUri)
    // consumes structuredContent through the host's tool-result event.
    expect(result.content.length).toBe(1)
    expect((result.content[0] as { type: string }).type).toBe("text")
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.jobId).toBe("j-123")
    expect(sc?.prompt).toBe("a knight Mood: epic.")
  })

  it("returns isError when /v1/generate-image responds 400", async () => {
    const fastify = Fastify()
    fastify.post("/v1/generate-image", async (_req, reply) => reply.status(400).send({ error: "bad" }))
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "test" })
    expect(result.isError).toBe(true)
  })

  // Regression: reference_image_urls used to be missing from the schema
  // entirely — the SDK's z.object() stripped the unknown key, the job ran
  // as plain t2i, and the user's reference was silently ignored.
  it("forwards reference_image_urls to the route and reports the count in the response text", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-ref" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", {
      prompt: "same woman, full body",
      model: "nano-banana-pro",
      reference_image_urls: ["https://cdn.nodaro.ai/uploads/images/ref-1.png"],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.referenceImageUrls).toEqual([
      "https://cdn.nodaro.ai/uploads/images/ref-1.png",
    ])
    expect((result.content[0] as { text: string }).text).toContain("1 reference image")
  })

  it("coerces a JSON-stringified reference_image_urls (client serialization slip) into an array", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-ref2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", {
      prompt: "same woman, full body",
      reference_image_urls: "[\"https://cdn.nodaro.ai/uploads/images/ref-1.png\"]",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.referenceImageUrls).toEqual([
      "https://cdn.nodaro.ai/uploads/images/ref-1.png",
    ])
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_image")
  })
})

describe("modify_image verb", () => {
  it("calls /v1/image-to-image with image_url + composed prompt", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-mi" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "modify_image", {
      prompt: "make it dark",
      image_url: "https://example.com/a.png",
      model: "flux-i2i",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-mi")
    expect(received.body?.imageUrl).toBe("https://example.com/a.png")
    expect(received.body?.provider).toBe("flux-i2i")
  })

  it("returns isError when neither image_url nor image_asset_id is provided", async () => {
    const { fastify } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-mi" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "modify_image", { prompt: "x" })
    expect(result.isError).toBe(true)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("modify_image")
  })
})

describe("generate_video verb", () => {
  it("calls /v1/text-to-video with snake_case → camelCase translation", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-tv" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_video", {
      prompt: "a sunset",
      model: "veo3.1",
      aspect_ratio: "16:9",
      sound: true,
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-tv")
    expect(received.body?.aspectRatio).toBe("16:9")
    expect(received.body?.provider).toBe("veo3.1")
  })

  // Surface guard (C1): Seedance 2's full tier supports `resolution: "4k"` and
  // `aspect_ratio: "adaptive"`. The tool's `resolution`/`aspect_ratio` are
  // permissive `z.string()` and `normalizeVideoInput` passes valid values
  // through untouched, so both must reach the /v1/text-to-video body verbatim.
  // Pins this so a future enum-tightening on the MCP layer can't silently drop
  // 4k / adaptive before they reach the route.
  it("forwards resolution=4k + aspect_ratio=adaptive unaltered for seedance-2", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-sd2-4k" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_video", {
      prompt: "a city skyline at dusk",
      model: "seedance-2",
      resolution: "4k",
      aspect_ratio: "adaptive",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.provider).toBe("seedance-2")
    expect(received.body?.resolution).toBe("4k")
    expect(received.body?.aspectRatio).toBe("adaptive")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_video")
  })
})

describe("animate_image verb", () => {
  it("calls /v1/generate-video for image-to-video", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-video", { jobId: "j-ai" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "animate_image", {
      prompt: "drift forward",
      image_url: "https://example.com/x.jpg",
      model: "kling-turbo",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-ai")
    expect(received.body?.imageUrl).toBe("https://example.com/x.jpg")
  })

  it("returns isError on missing image", async () => {
    const { fastify } = stubRoute("POST", "/v1/generate-video", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "animate_image", { prompt: "x" })
    expect(result.isError).toBe(true)
  })

  it("forwards reference_audio_urls when provider is seedance-2", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-video", { jobId: "j-sd2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "animate_image", {
      image_url: "https://x/y.png",
      model: "seedance-2",
      reference_audio_urls: ["https://cdn/x.mp3"],
    })
    expect(received.body?.referenceAudioUrls).toEqual(["https://cdn/x.mp3"])
    expect(received.body?.provider).toBe("seedance-2")
  })

  it("drops reference_audio_urls when provider is veo3 (silent ignore)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-video", { jobId: "j-veo" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "animate_image", {
      image_url: "https://x/y.png",
      model: "veo3",
      reference_audio_urls: ["https://cdn/x.mp3"],
    })
    expect(received.body?.referenceAudioUrls).toBeUndefined()
  })

  it("rejects reference_video_urls + end_frame_url combination with isError", async () => {
    const { fastify } = stubRoute("POST", "/v1/generate-video", { jobId: "j-conflict" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "animate_image", {
      image_url: "https://x/y.png",
      end_frame_url: "https://x/end.png",
      model: "seedance-2",
      reference_video_urls: ["https://cdn/v.mp4"],
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/cannot be combined/)
  })
})

describe("extend_video verb", () => {
  it("calls /v1/extend-video with task_id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/extend-video", { jobId: "j-ex" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "extend_video", {
      prompt: "more",
      task_id: "k-1",
      model: "veo-extend",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-ex")
    expect(received.body?.taskId).toBe("k-1")
    expect(received.body?.provider).toBe("veo-extend")
  })

  it("still accepts the deprecated kie_task_id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/extend-video", { jobId: "j-ex" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "extend_video", { prompt: "more", kie_task_id: "k-1", model: "veo-extend" })

    expect(result.isError).toBeUndefined()
    expect(received.body?.taskId).toBe("k-1")
  })

  it("names the neutral task_id when it is missing", async () => {
    const { fastify } = stubRoute("POST", "/v1/extend-video", { jobId: "j-ex" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "extend_video", { prompt: "more", model: "veo-extend" })

    expect(result.isError).toBe(true)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/task_id/)
    expect(text).not.toMatch(/kie/i)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("extend_video")
  })
})

describe("combine_videos verb", () => {
  it("calls /v1/combine-videos with array of urls", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/combine-videos", { jobId: "j-cv" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "combine_videos", {
      videos: [{ url: "https://a/v1.mp4" }, { url: "https://a/v2.mp4" }],
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-cv")
    expect(Array.isArray(received.body?.videoUrls)).toBe(true)
    expect((received.body?.videoUrls as string[]).length).toBe(2)
  })

  it("returns isError if a video item lacks url and asset_id", async () => {
    const { fastify } = stubRoute("POST", "/v1/combine-videos", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "combine_videos", {
      videos: [{ url: "https://a/v.mp4" }, {}],
    })
    expect(result.isError).toBe(true)
  })
})

describe("add_captions verb", () => {
  it("calls /v1/add-captions with video_url + text", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/add-captions", { jobId: "j-ac" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "add_captions", {
      video_url: "https://a/v.mp4",
      text: "Hello",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-ac")
    expect(received.body?.videoUrl).toBe("https://a/v.mp4")
    expect(received.body?.text).toBe("Hello")
  })

  it("returns isError if no video supplied", async () => {
    const { fastify } = stubRoute("POST", "/v1/add-captions", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "add_captions", { text: "x" })
    expect(result.isError).toBe(true)
  })
})

describe("extract_frame verb", () => {
  it("calls /v1/extract-frame with mode='timestamp'", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/extract-frame", { jobId: "j-ef" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "extract_frame", {
      video_url: "https://a/v.mp4",
      mode: "timestamp",
      time_seconds: 12.5,
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-ef")
    expect(received.body?.timestamp).toBe(12.5)
    expect(received.body?.mode).toBe("timestamp")
  })

  it("returns isError without video", async () => {
    const { fastify } = stubRoute("POST", "/v1/extract-frame", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "extract_frame", { mode: "first" })
    expect(result.isError).toBe(true)
  })
})

describe("lip_sync verb", () => {
  it("calls /v1/lip-sync with image + audio", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/lip-sync", { jobId: "j-ls" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "lip_sync", {
      image_url: "https://example.com/face.jpg",
      audio_url: "https://example.com/voice.mp3",
      model: "kling-avatar-pro",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-ls")
    expect(received.body?.imageUrl).toBe("https://example.com/face.jpg")
    expect(received.body?.audioUrl).toBe("https://example.com/voice.mp3")
    expect(received.body?.provider).toBe("kling-avatar-pro")
  })

  it("defaults provider to kling-avatar", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "lip_sync", {
      image_url: "https://a/face.jpg",
      audio_url: "https://a/v.mp3",
    })
    expect(received.body?.provider).toBe("kling-avatar")
  })

  it("forwards audio_duration_sec as audioDurationSec and measures nothing", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "lip_sync", { video_url: "https://a/clip.mp4", audio_url: "https://a/v.mp3", model: "heygen-lipsync-precision", audio_duration_sec: 8 })
    expect(received.body?.audioDurationSec).toBe(8)
    expect(audio.measured).not.toHaveBeenCalled()
  })

  it("a per-second model with no length measures the audio first, so a 10 s file reserves the 15 s bucket", async () => {
    audio.measured.mockResolvedValue(10.1)
    const { fastify, received } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "lip_sync", { video_url: "https://a/clip.mp4", audio_url: "https://a/v.mp3", model: "heygen-lipsync-precision" })
    expect(audio.measured).toHaveBeenCalledWith("https://a/v.mp3")
    expect(received.body?.audioDurationSec).toBe(10.1)
    expect(buildLipSyncCreditId("heygen-lipsync-precision", received.body?.audioDurationSec as number)).toBe("heygen-lipsync-precision:15s")
  })

  it("a failed measurement sends no length (the route keeps today's bucket)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "lip_sync", { video_url: "https://a/clip.mp4", audio_url: "https://a/v.mp3", model: "heygen-lipsync-precision" })
    expect(audio.measured).toHaveBeenCalled()
    expect(received.body).not.toHaveProperty("audioDurationSec")
  })

  it("a model that is not billed by the second is never measured", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "lip_sync", { image_url: "https://a/face.jpg", audio_url: "https://a/v.mp3", model: "infinitalk" })
    expect(audio.measured).not.toHaveBeenCalled()
    expect(received.body).not.toHaveProperty("audioDurationSec")
  })

  it("returns isError without face source", async () => {
    const { fastify } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "lip_sync", {
      audio_url: "https://a/v.mp3",
    })
    expect(result.isError).toBe(true)
  })

  it("returns isError without audio", async () => {
    const { fastify } = stubRoute("POST", "/v1/lip-sync", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "lip_sync", {
      image_url: "https://a/face.jpg",
    })
    expect(result.isError).toBe(true)
  })
})

describe("generate_music verb", () => {
  it("dispatches model=minimax to /v1/generate-music", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-music", { jobId: "j-gm" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_music", {
      prompt: "lofi beat",
      model: "minimax",
      duration: 20,
      instrumental: true,
      reference_audio_url: "https://cdn.nodaro.ai/audio/ref.mp3",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-gm")
    expect(received.body?.provider).toBe("minimax")
    expect(received.body?.duration).toBe(20)
    // MiniMax Music follows a reference track — the route refuses a run without one.
    expect(received.body?.referenceAudioUrl).toBe("https://cdn.nodaro.ai/audio/ref.mp3")
  })

  it("dispatches model=suno-v5 to /v1/suno/generate with model=V5", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/generate", { jobId: "j-suno" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_music", {
      prompt: "uplifting indie pop",
      model: "suno-v5",
      lyrics: "verse one",
      genre: "indie pop",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.model).toBe("V5")
    expect(received.body?.lyrics).toBe("verse one")
    expect(received.body?.style).toBe("indie pop")
    // WORDS TO SING ⇒ CUSTOM MODE (2026-08-19): lyrics only reach Suno there
    // (in description mode the model invents its own words and `duration` is
    // ignored), and custom mode requires a title — defaulted when absent.
    expect(received.body?.customMode).toBe(true)
    expect(received.body?.title).toBe("Untitled")
  })

  it("lyrics + title + duration ride custom mode; duration is raised to the route's 10s floor", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/generate", { jobId: "j-custom" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_music", {
      prompt: "acoustic world-jazz, upright bass, hand percussion",
      model: "suno-v5-5",
      lyrics: "[Intro]\nPa ra pa pa pri pa",
      title: "Studio Session",
      duration: 6,
    })

    expect(received.body?.customMode).toBe(true)
    expect(received.body?.title).toBe("Studio Session")
    expect(received.body?.duration).toBe(10)
    // No genre/mood given → the prompt itself is the style (custom mode requires one).
    expect(received.body?.style).toBe("acoustic world-jazz, upright bass, hand percussion")
  })

  /**
   * INSTRUMENTAL + A LENGTH OR A TITLE ⇒ CUSTOM MODE (2026-08-20). Description
   * mode drops `duration`, so a 22-second score request returned 142 seconds.
   * There is no voice on an instrumental track, so no lyrics ride and nothing
   * can be sung by accident.
   */
  it("an INSTRUMENTAL request with a duration goes custom — the length is the whole reason — and never carries lyrics", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/generate", { jobId: "j-inst" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_music", { prompt: "solo piano, sparse", model: "suno-v5-5", lyrics: "[Verse]\nignored", instrumental: true, duration: 22 })

    expect(received.body?.customMode).toBe(true)
    expect(received.body?.duration).toBe(22)
    expect(received.body?.title).toBe("Untitled")
    expect(received.body?.style).toBe("solo piano, sparse")
    expect(received.body?.lyrics).toBeUndefined()
  })

  it("a plain instrumental request — no title, no duration — is unchanged: description mode", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/generate", { jobId: "j-plain" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_music", { prompt: "ambient drone", model: "suno-v5-5", instrumental: true })

    expect(received.body?.customMode).toBeUndefined()
    expect(received.body?.title).toBeUndefined()
  })

  it("no lyrics: description mode as before, and a caller-supplied title still rides", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/generate", { jobId: "j-desc" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_music", { prompt: "lofi beat", model: "suno-v5-5", title: "Night Study" })

    expect(received.body?.customMode).toBeUndefined()
    expect(received.body?.title).toBe("Night Study")
  })

  it("dispatches model=suno (v4) to /v1/suno/generate with model=V4", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/generate", { jobId: "j-suno-v4" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_music", { prompt: "ambient", model: "suno" })
    expect(received.body?.model).toBe("V4")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_music")
  })
})

describe("generate_speech verb", () => {
  it("calls /v1/text-to-speech with translated keys", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-speech", { jobId: "j-tts" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_speech", {
      text: "Hello world",
      voice_id: "alice",
      similarity_boost: 0.5,
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-tts")
    expect(received.body?.voice).toBe("alice")
    expect(received.body?.similarityBoost).toBe(0.5)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_speech")
  })
})

describe("download_youtube_audio verb", () => {
  it("calls /v1/extract-youtube-audio", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/extract-youtube-audio", { jobId: "j-yt" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "download_youtube_audio", {
      youtube_url: "https://youtu.be/abc",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-yt")
    expect(received.body?.youtubeUrl).toBe("https://youtu.be/abc")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("download_youtube_audio")
  })
})

describe("generate_character verb", () => {
  it("calls /v1/generate-character on kind='main' and consumes { jobId, jobIds } shape", async () => {
    // Backend route returns dual shape after Task 6 of character-studio PR 1.
    // MCP tool surfaces only the first job id (count=1 implied at this layer).
    const { fastify, received } = stubRoute("POST", "/v1/generate-character", {
      jobId: "j-c1",
      jobIds: ["j-c1"],
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "main",
      name: "Aria",
      style: "anime",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-c1")
    expect(received.body?.name).toBe("Aria")
    expect(received.body?.style).toBe("anime")
  })

  it("prefers jobIds[0] when present", async () => {
    // Defensive contract — if the backend ever returns a mismatched jobId
    // and jobIds[0] (shouldn't happen, but guards against drift), the tool
    // honors jobIds[0] as the authoritative first-job identifier.
    const { fastify } = stubRoute("POST", "/v1/generate-character", {
      jobId: "j-stale",
      jobIds: ["j-fresh"],
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "main",
      name: "Aria",
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-fresh")
  })

  it("calls /v1/generate-character-asset on kind='asset' with asset_type+variant", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-character-asset", { jobId: "j-c2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "asset",
      name: "Aria",
      asset_type: "expressions",
      variant: "smile",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-c2")
    expect(received.body?.assetType).toBe("expressions")
    expect(received.body?.variant).toBe("smile")
  })

  it("returns isError on kind='asset' without asset_type", async () => {
    const { fastify } = stubRoute("POST", "/v1/generate-character-asset", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_character", {
      kind: "asset",
      name: "Aria",
    })
    expect(result.isError).toBe(true)
  })

  it("forwards bodyAngles + attach_to_character_id to /v1/generate-character-asset", async () => {
    // Reproduces the user complaint "i cannot generate expressions and
    // head/body angles shots via mcp" — verifies the consolidated
    // `generate_character` (kind=asset) tool now accepts the previously
    // missing `bodyAngles` enum and the studio attach-* fields.
    const KIRA_ID = "11111111-1111-4111-8111-111111111111"
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/generate-character-asset",
      { jobId: "job-body-back" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "asset",
      name: "Kira",
      asset_type: "bodyAngles",
      variant: "back",
      attach_to_character_id: KIRA_ID,
      attach_name: "Back body angle",
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("job-body-back")
    // camelCase translation: snake_case MCP input → camelCase route payload.
    expect(received.body?.assetType).toBe("bodyAngles")
    expect(received.body?.variant).toBe("back")
    expect(received.body?.attachToCharacterId).toBe(KIRA_ID)
    expect(received.body?.attachName).toBe("Back body angle")
    // Session-derived identity travels through so the route's auth + scope
    // resolution lands on the right user.
    expect(received.body?.userId).toBe("u1")
    expect(received.body?.mcp_client).toBe("Claude")
  })

  it("forwards expressions + attach_to_character_id without attach_to_column (route picks bucket)", async () => {
    // For canonical asset types the route derives the column from
    // assetType — no client-side pre-check, and the MCP layer must NOT
    // forge an attachToColumn. We only need to verify that
    // attachToColumn is absent from the forwarded payload (the route
    // itself owns the bucket-resolution logic).
    const KIRA_ID = "11111111-1111-4111-8111-111111111111"
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/generate-character-asset",
      { jobId: "job-smile" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "asset",
      name: "Kira",
      asset_type: "expressions",
      variant: "smile",
      attach_to_character_id: KIRA_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.assetType).toBe("expressions")
    expect(received.body?.attachToCharacterId).toBe(KIRA_ID)
    expect(received.body?.attachToColumn).toBeUndefined()
    expect(received.body?.attachName).toBeUndefined()
  })

  it("surfaces the route's 400 verbatim (custom + missing attach_to_column)", async () => {
    // For asset_type='custom' the route enforces attach_to_column when
    // attach_to_character_id is set — the worker can't infer the bucket
    // from a 'custom' assetType. The MCP layer does NOT pre-check this;
    // the route's response IS the answer.
    const KIRA_ID = "11111111-1111-4111-8111-111111111111"
    const fastify = Fastify()
    fastify.post("/v1/generate-character-asset", async (_req, reply) => {
      return reply
        .status(400)
        .send({ error: { code: "validation_error", message: "attachToColumn is required for custom asset_type" } })
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "asset",
      name: "Kira",
      asset_type: "custom",
      variant: "noir",
      attach_to_character_id: KIRA_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("validation_error")
  })

  it("forwards custom + attach_to_column when supplied", async () => {
    const KIRA_ID = "11111111-1111-4111-8111-111111111111"
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/generate-character-asset",
      { jobId: "job-custom-1" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_character", {
      kind: "asset",
      name: "Kira",
      asset_type: "custom",
      variant: "noir",
      attach_to_character_id: KIRA_ID,
      attach_to_column: "lighting_variations",
      attach_name: "Noir",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.assetType).toBe("custom")
    expect(received.body?.attachToColumn).toBe("lighting_variations")
    expect(received.body?.attachName).toBe("Noir")
  })
})

describe("generate_location verb", () => {
  it("calls /v1/generate-location on kind='main'", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-location", { jobId: "j-l1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_location", {
      kind: "main",
      name: "Forest",
      category: "nature",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-l1")
    expect(received.body?.category).toBe("nature")
  })

  it("accepts seasons asset_type and forwards attach_to_location_id + attach_name", async () => {
    // Seasons is a NEW asset_type added in Location Studio PR-1 — the old enum
    // only had timeOfDay/weather/angles/custom. Also verifies the studio
    // attach-* fields land on the route as camelCase.
    const FOREST_ID = "22222222-2222-4222-8222-222222222222"
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/generate-location-asset",
      { jobId: "job-season-autumn" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_location", {
      kind: "asset",
      name: "Forest",
      asset_type: "seasons",
      variant: "autumn",
      attach_to_location_id: FOREST_ID,
      attach_name: "Autumn",
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("job-season-autumn")
    expect(received.body?.assetType).toBe("seasons")
    expect(received.body?.variant).toBe("autumn")
    expect(received.body?.attachToLocationId).toBe(FOREST_ID)
    expect(received.body?.attachName).toBe("Autumn")
  })

  it("accepts lighting asset_type (new in PR-1)", async () => {
    const FOREST_ID = "22222222-2222-4222-8222-222222222222"
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/generate-location-asset",
      { jobId: "job-light-golden" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_location", {
      kind: "asset",
      name: "Forest",
      asset_type: "lighting",
      variant: "golden-hour",
      attach_to_location_id: FOREST_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.assetType).toBe("lighting")
    expect(received.body?.attachToLocationId).toBe(FOREST_ID)
    // No attachToColumn for canonical asset types — route derives the bucket.
    expect(received.body?.attachToColumn).toBeUndefined()
  })

  it("forwards custom + attach_to_column when supplied", async () => {
    const FOREST_ID = "22222222-2222-4222-8222-222222222222"
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/generate-location-asset",
      { jobId: "job-custom-loc" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_location", {
      kind: "asset",
      name: "Forest",
      asset_type: "custom",
      variant: "misty",
      attach_to_location_id: FOREST_ID,
      attach_to_column: "atmosphere_motions",
      attach_name: "Misty",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.assetType).toBe("custom")
    expect(received.body?.attachToColumn).toBe("atmosphere_motions")
    expect(received.body?.attachName).toBe("Misty")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_location")
  })
})

describe("generate_object verb", () => {
  it("calls /v1/generate-object on kind='main'", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-object", { jobId: "j-o1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_object", {
      kind: "main",
      name: "Sword",
      category: "weapon",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-o1")
    expect(received.body?.name).toBe("Sword")
  })

  it("calls /v1/generate-object-asset on kind='asset'", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-object-asset", { jobId: "j-o2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_object", {
      kind: "asset",
      name: "Sword",
      asset_type: "materials",
      variant: "metal",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.assetType).toBe("materials")
    expect(received.body?.variant).toBe("metal")
  })
})

// generate_creature mirrors generate_object 1:1 with the Animal/Creature
// delta: free-text `species` field, and the asset_type enum swaps `materials`
// for `poses`. The main route returns the dual { jobId, jobIds } shape
// (harmonized with characters) so the tool prefers jobIds[0].
describe("generate_creature verb", () => {
  it("calls /v1/generate-creature on kind='main' and forwards species", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-creature", { jobId: "j-c1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_creature", {
      kind: "main",
      name: "Emerald Dragon",
      species: "dragon",
      category: "mythical",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-c1")
    expect(received.body?.name).toBe("Emerald Dragon")
    // Creature delta vs object — free-text species is forwarded to the route.
    expect(received.body?.species).toBe("dragon")
    expect(received.body?.category).toBe("mythical")
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("prefers jobIds[0] when the main route returns the dual shape", async () => {
    const { fastify } = stubRoute("POST", "/v1/generate-creature", {
      jobId: "j-legacy",
      jobIds: ["j-c-dual"],
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_creature", {
      kind: "main",
      name: "Wolf",
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-c-dual")
  })

  it("calls /v1/generate-creature-asset on kind='asset' with poses (materials->poses delta)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-creature-asset", { jobId: "j-c2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_creature", {
      kind: "asset",
      name: "Emerald Dragon",
      asset_type: "poses",
      variant: "standing",
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.assetType).toBe("poses")
    expect(received.body?.variant).toBe("standing")
  })

  it("errors when kind='asset' is missing asset_type/variant", async () => {
    const { fastify } = stubRoute("POST", "/v1/generate-creature-asset", { jobId: "j-c3" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_creature", {
      kind: "asset",
      name: "Emerald Dragon",
    })
    expect(result.isError).toBe(true)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("generate_creature")
  })
})

describe("voice_changer verb", () => {
  it("calls /v1/voice-changer with audio_url + voice_id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-changer", { jobId: "j-vc" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "voice_changer", {
      audio_url: "https://a/x.mp3",
      voice_id: "Rachel",
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId)).toBe("j-vc")
    expect(received.body?.audioUrl).toBe("https://a/x.mp3")
    expect(received.body?.voiceId).toBe("Rachel")
  })
})

describe("voice_changer_pro verb", () => {
  it("calls /v1/voice-changer-pro with video_url + ordered_voices", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-changer-pro", { jobId: "j-vr" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "voice_changer_pro", {
      video_url: "https://a/x.mp4",
      ordered_voices: ["v1", "v2"],
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId)).toBe("j-vr")
    expect(received.body?.videoUrl).toBe("https://a/x.mp4")
    expect(received.body?.orderedVoices).toEqual(["v1", "v2"])
    expect(received.body?.audioUrl).toBeUndefined()
  })

  it("passes per-voice objects + separation_quality straight through", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-changer-pro", { jobId: "j-vr2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const orderedVoices = [
      "Rachel",
      { voiceId: "Aria", stability: 0.6, volumeMode: "manual", volume: 120 },
    ]
    const result = await callTool(server, "voice_changer_pro", {
      audio_url: "https://a/x.mp3",
      ordered_voices: orderedVoices,
      separation_quality: "best",
      preserve_background: false,
      music_volume_mode: "manual",
      music_volume: 80,
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId)).toBe("j-vr2")
    // camelCase object fields pass straight through to the route.
    expect(received.body?.orderedVoices).toEqual(orderedVoices)
    expect(received.body?.separationQuality).toBe("best")
    expect(received.body?.preserveBackground).toBe(false)
    // snake_case music_volume_mode / music_volume → camelCase musicVolumeMode / musicVolume.
    expect(received.body?.musicVolumeMode).toBe("manual")
    expect(received.body?.musicVolume).toBe(80)
  })

  it("forwards per-voice seed and maps voice_fx → voiceFx", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-changer-pro", { jobId: "j-vr3" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const orderedVoices = [
      { voiceId: "Rachel", seed: 12345 },
      { voiceId: "Aria", seed: 67890 },
    ]
    const result = await callTool(server, "voice_changer_pro", {
      audio_url: "https://a/x.mp3",
      ordered_voices: orderedVoices,
      voice_fx: { preset: "hall", wetDryMix: 35 },
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId)).toBe("j-vr3")
    // Per-voice seed rides through inside the ordered_voices objects verbatim.
    expect(received.body?.orderedVoices).toEqual(orderedVoices)
    // snake_case top-level voice_fx → camelCase voiceFx (mirrors separationQuality).
    expect(received.body?.voiceFx).toEqual({ preset: "hall", wetDryMix: 35 })
  })

  // Keep-slots: a null entry means "keep this speaker's original voice"
  // (cloud-plugins orderedVoices contract). The verb must accept nulls and
  // forward them positionally — and must not crash building the widget
  // prompt label (null has no .voiceId).
  it("forwards null keep-slots positionally", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-changer-pro", { jobId: "j-vr4" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "voice_changer_pro", {
      audio_url: "https://a/x.mp3",
      ordered_voices: ["Rachel", null, { voiceId: "Aria", stability: 0.6 }],
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId)).toBe("j-vr4")
    expect(received.body?.orderedVoices).toEqual(["Rachel", null, { voiceId: "Aria", stability: 0.6 }])
  })

  it("rejects all-null ordered_voices at the schema layer", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-changer-pro", { jobId: "j-vr5" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    // Schema-level failures throw (MCP InvalidParams) before the handler runs —
    // nothing may be dispatched to the route. (Or return isError=true if SDK version does.)
    const result = await callTool(server, "voice_changer_pro", {
      audio_url: "https://a/x.mp3",
      ordered_voices: [null, null],
    })
    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })
})

describe("dubbing verb", () => {
  it("calls /v1/dubbing with audio + target_language", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/dubbing", { jobId: "j-db" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "dubbing", {
      audio_url: "https://a/x.mp3",
      target_language: "es",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.targetLanguage).toBe("es")
  })
})

describe("voice_design verb", () => {
  it("calls /v1/voice-design with text + voice_description", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/voice-design", { jobId: "j-vd" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "voice_design", {
      text: "x".repeat(120),
      voice_description: "warm female narrator with a soft British accent",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.voiceDescription).toBe(
      "warm female narrator with a soft British accent",
    )
  })
})

describe("generate_script verb", () => {
  it("forwards style_guide as styleGuide, beside the other settings", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-script", { jobId: "j-gs" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_script", {
      prompt: "a lighthouse keeper's last night",
      scene_count: 4,
      tone: "wistful",
      target_duration: 45,
      style_guide: "noir, short lines, rain in every scene",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body).toMatchObject({
      prompt: "a lighthouse keeper's last night",
      sceneCount: 4,
      tone: "wistful",
      targetDuration: 45,
      styleGuide: "noir, short lines, rain in every scene",
    })
  })

  it("sends no styleGuide when none is given", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-script", { jobId: "j-gs2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "generate_script", { prompt: "a short story" })
    expect(received.body).not.toHaveProperty("styleGuide")
  })
})

describe("suno_upload_extend verb", () => {
  // The provider's `defaultParamFlag: true` is its CUSTOM mode (the caller's
  // style / title / continueAt), so it is the inverse of `use_default_params`.
  it("uses the caller's style and title by default (defaultParamFlag: true)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/upload-extend", { jobId: "j-ue" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "suno_upload_extend", {
      audio_url: "https://cdn.example/song.mp3",
      continue_at: 30,
      style: "lo-fi",
      title: "Night drive",
    })
    expect(received.body).toMatchObject({ defaultParamFlag: true, style: "lo-fi", title: "Night drive" })
  })

  it("lets Suno pick when use_default_params is true (defaultParamFlag: false)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/upload-extend", { jobId: "j-ue2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "suno_upload_extend", {
      audio_url: "https://cdn.example/song.mp3",
      continue_at: 30,
      use_default_params: true,
    })
    expect(received.body).toMatchObject({ defaultParamFlag: false })
  })
})

// suno_separate_stems / suno_extend error-path coverage requires a
// supabase mock that matches resolveSunoIds' specific column selection
// (output_data, user_id, is_public, status). The shared file-level mock
// stubs maybeSingle() with data:null but the chain hangs on these tools
// when invoked through the SDK's tools/call dispatcher. Happy paths for
// these two are exercised through suno_cover (same audio-resolution
// helper) + manual smoke after deploy.

describe("suno_cover verb", () => {
  it("calls /v1/suno/cover with prompt + uploadUrl", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/cover", { jobId: "j-cv" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "suno_cover", {
      prompt: "lo-fi jazz cover",
      audio_url: "https://a/song.mp3",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.prompt).toBe("lo-fi jazz cover")
    expect(received.body?.uploadUrl).toBe("https://a/song.mp3")
    expect(received.body?.model).toBe("V6")
  })
})

describe("modify_video verb", () => {
  it("calls /v1/video-to-video with prompt + provider=wan", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-to-video", { jobId: "j-mv" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "modify_video", {
      prompt: "make it cyberpunk",
      video_url: "https://a/v.mp4",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.prompt).toBe("make it cyberpunk")
    expect(received.body?.provider).toBe("wan")
  })

  it("seedance-2-5 dispatches through the Seedance reference-video lane, in edit shape", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-edit" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "modify_video", {
      prompt: "the woman wears {image:1}",
      video_url: "https://a/v.mp4",
      model: "seedance-2-5",
      resolution: "480p",
      reference_image_urls: ["https://a/coat.jpg"],
    })
    expect(result.isError).toBeUndefined()
    expect(received.body).toMatchObject({
      provider: "seedance-2-5",
      prompt: "edit {video:1} as follows:\nthe woman wears {image:1}",
      aspectRatio: "adaptive",
      duration: -1,
      resolution: "480p",
      referenceVideoUrls: ["https://a/v.mp4"],
      referenceImageUrls: ["https://a/coat.jpg"],
    })
    expect(received.body).not.toHaveProperty("videoUrl")
  })

  it("returns isError without video", async () => {
    const { fastify } = stubRoute("POST", "/v1/video-to-video", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "modify_video", { prompt: "x" })
    expect(result.isError).toBe(true)
  })
})

describe("motion_transfer verb", () => {
  it("calls /v1/motion-transfer with image + video", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/motion-transfer", { jobId: "j-mt" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "motion_transfer", {
      image_url: "https://a/face.jpg",
      video_url: "https://a/move.mp4",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.imageUrl).toBe("https://a/face.jpg")
    expect(received.body?.videoUrl).toBe("https://a/move.mp4")
    expect(received.body?.provider).toBe("kling")
    expect(received.body?.resolution).toBe("720p")
  })

  it("returns isError without character image", async () => {
    const { fastify } = stubRoute("POST", "/v1/motion-transfer", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "motion_transfer", {
      video_url: "https://a/v.mp4",
    })
    expect(result.isError).toBe(true)
  })
})

describe("video_analysis verb", () => {
  it("calls /v1/video-analysis with snake_case → camelCase translation, always on the Smart tier", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-analysis", { jobId: "j-va" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_analysis", {
      video_url: "https://a/clip.mp4",
      variations: true,
      music_video: true,
      analysis_focus: "focus on the product shots",
    })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-va")
    expect(received.body?.videoUrl).toBe("https://a/clip.mp4")
    // The tool has ONE analysis quality: it always asks the route for the
    // Smart tier (the route resolves tier → engine plan) …
    expect(received.body?.llmModel).toBe("smart")
    // … and never sends a result strategy: Smart always refines its result.
    expect(received.body).not.toHaveProperty("selectionMode")
    // The job card names the tier that ran.
    expect((result.structuredContent as Record<string, unknown>)?.model).toBe("smart")
    // Cast-variations opt-in forwards as-is (parity with the node checkbox and
    // recast — the verb previously had no way to request looks at all).
    expect(received.body?.variations).toBe(true)
    // Music-video lyric mode forwards snake→camel (plugin ≥0.144.0 consumes it;
    // older plugins strip the unknown key — same posture as `variations`).
    expect(received.body?.musicVideo).toBe(true)
    expect(received.body?.analysisFocus).toBe("focus on the product shots")
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("a caller still sending the retired llm_model / selection_mode gets Smart — the keys are dropped, not forwarded", async () => {
    // A client holding a cached tool list can still send them. The SDK's input
    // parse strips keys the schema no longer declares, so the call runs (it is
    // not rejected) and runs Smart, never the tier the caller asked for.
    const { fastify, received } = stubRoute("POST", "/v1/video-analysis", { jobId: "j-va-stale" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_analysis", {
      video_url: "https://a/clip.mp4",
      llm_model: "fast",
      selection_mode: "choose",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.llmModel).toBe("smart")
    expect(received.body).not.toHaveProperty("selectionMode")
    expect(received.body).not.toHaveProperty("llm_model")
    expect(received.body).not.toHaveProperty("selection_mode")
  })

  it("offers no analysis-quality choice: llm_model and selection_mode are gone, every other parameter stays", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "video_analysis")
    const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    expect(Object.keys(properties).sort()).toEqual(
      [
        "video_asset_id",
        "video_url",
        "youtube_url",
        "variations",
        "music_video",
        "translate_speech_to_english",
        "translate_on_screen_text_to_english",
        "analysis_focus",
      ].sort(),
    )
  })

  it("prices only the Smart ladder, read from the shared credit table", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "video_analysis")
    const pricing = tool?.description?.split("**Pricing**")[1] ?? ""
    // A tier prices under the engine it resolves to (`pro` → its model id,
    // `smart` / `mixed` → their own sentinels), exactly as the route does.
    const ladderOf = (tier: string) =>
      VIDEO_ANALYSIS_DURATION_BUCKETS.map(
        (b) => VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(resolveVideoAnalysisModel(tier), b)],
      )
    const smart = ladderOf("smart")
    // Every Smart bucket is priced. Without this, a missing row would read
    // "undefined" in the expected string AND the description, and pass.
    for (const credits of smart) expect(credits).toBeGreaterThan(0)
    // No other tier is named or priced. Each of their ladders is checked as
    // priced first, so its absence below is a real check, not a search for "///".
    for (const tier of VIDEO_ANALYSIS_TIER_ORDER.filter((t) => t !== "smart")) {
      const ladder = ladderOf(tier)
      for (const credits of ladder) expect(credits).toBeGreaterThan(0)
      expect(pricing).not.toMatch(new RegExp(`\\b${tier}\\b`, "i"))
      expect(pricing).not.toContain(ladder.join("/"))
    }
    expect(pricing).toContain(`${smart.join("/")} credits`)
    expect(pricing).toMatch(/\bSmart\b/)
  })

  it("omits musicVideo entirely when music_video is absent or false", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-analysis", { jobId: "j-va-mv" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_analysis", {
      video_url: "https://a/clip.mp4",
      music_video: false,
    })
    expect(result.isError).toBeUndefined()
    expect(received.body ? "musicVideo" in received.body : false).toBe(false)
  })

  it("forwards youtube_url as youtubeUrl", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-analysis", { jobId: "j-va-yt" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_analysis", {
      youtube_url: "https://www.youtube.com/watch?v=abc123",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.youtubeUrl).toBe("https://www.youtube.com/watch?v=abc123")
    expect(received.body?.videoUrl).toBeUndefined()
  })

  it("rejects two sources with isError naming what was provided", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-analysis", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_analysis", {
      video_url: "https://a/clip.mp4",
      youtube_url: "https://youtu.be/abc123",
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("exactly one")
    expect((result.content[0] as { text: string }).text).toContain("video_url + youtube_url")
    expect(received.body).toBeUndefined() // never dispatched
  })

  it("rejects zero sources with isError", async () => {
    const { fastify } = stubRoute("POST", "/v1/video-analysis", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_analysis", {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("none provided")
  })

  it("is omitted without workflows:execute", async () => {
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("video_analysis")
  })
})

describe("video_audit verb", () => {
  it("calls /v1/video-audit with snake_case → camelCase translation, forwarding analysis verbatim", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-audit", { jobId: "j-vaud" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const analysis = { meta: { language: "en" }, slots: [], scenes: [{ visualResolved: "a knight" }] }
    const result = await callTool(server, "video_audit", {
      video_url: "https://a/clip.mp4",
      analysis,
    })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-vaud")
    expect(received.body?.videoUrl).toBe("https://a/clip.mp4")
    // Passed through verbatim — no reshaping of the analysis blob.
    expect(received.body?.analysis).toEqual(analysis)
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("omits analysis from the payload when not provided (auto family)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-audit", { jobId: "j-vaud-auto" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "video_audit", {
      video_url: "https://a/clip.mp4",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.videoUrl).toBe("https://a/clip.mp4")
    expect(received.body?.analysis).toBeUndefined()
  })

  it("is omitted without workflows:execute", async () => {
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("video_audit")
  })
})

describe("silence_detect verb", () => {
  it("calls /v1/silence-detect with audio_url + snake_case → camelCase tuning", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/silence-detect", { jobId: "j-sd" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "silence_detect", {
      audio_url: "https://a/ep.mp3",
      threshold_db: -40,
      min_silence_ms: 500,
      pad_ms: 80,
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-sd")
    expect(received.body?.audioUrl).toBe("https://a/ep.mp3")
    expect(received.body?.thresholdDb).toBe(-40)
    expect(received.body?.minSilenceMs).toBe(500)
    expect(received.body?.padMs).toBe(80)
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("silence_detect")
  })
})

describe("audio_sync verb", () => {
  it("calls /v1/audio-sync with the sources verbatim and the chosen reference", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/audio-sync", { jobId: "j-as" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const sources = [
      { id: "mic", url: "https://a/mic.m4a" },
      { id: "camA", url: "https://a/camA.mp4" },
      { id: "camB", url: "https://a/camB.mp4" },
    ]
    const result = await callTool(server, "audio_sync", { sources, reference: "camA" })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-as")
    expect(received.body?.sources).toEqual(sources)
    expect(received.body?.reference).toBe("camA")
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("omits reference when none is given (the route defaults to the first source)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/audio-sync", { jobId: "j-as2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "audio_sync", {
      sources: [{ id: "a", url: "https://a/a.wav" }, { id: "b", url: "https://a/b.wav" }],
    })
    expect(received.body && "reference" in received.body).toBe(false)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("audio_sync")
  })
})

// B4 (decided 2026-09-25): plan_edit takes audio_sync's result and writes it
// onto the sources before dispatch — refused, before any charge, when it
// would render out of sync.
describe("plan_edit verb — audio_sync offsets", () => {
  const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }] }
  const sources = [
    { id: "mic", url: "https://a/mic.m4a", kind: "audio", role: "master-audio" },
    { id: "camA", url: "https://a/camA.mp4", kind: "video" },
  ]
  const sync = (confidence: number) => ({
    version: 1,
    reference: "mic",
    offsets: [
      { sourceId: "mic", offsetMs: 0, confidence: 1, driftMsPerHour: 0 },
      { sourceId: "camA", offsetMs: 2_000, confidence, driftMsPerHour: 0 },
    ],
    notes: [],
  })

  it("writes the measured offsets onto the sources (and stamps the transcript's source); `offsets` is never sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "j-ep" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "plan_edit", { mode: "tighten", transcript, sources, offsets: sync(0.9), transcript_source_id: "mic" })
    expect(result.isError).toBeUndefined()
    expect(received.body?.sources).toEqual([sources[0], { ...sources[1], offsetMs: 2_000 }])
    expect(received.body && "offsets" in received.body).toBe(false)
    expect((received.body?.transcript as { sourceId?: string }).sourceId).toBe("mic")
  })

  it("accepts the result as a JSON string too", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "j-ep2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "plan_edit", { mode: "tighten", transcript, sources, offsets: JSON.stringify(sync(0.9)) })
    expect((received.body?.sources as Array<{ offsetMs?: number }>)[1]!.offsetMs).toBe(2_000)
  })

  it("refuses a weak match before dispatch — nothing is charged", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "plan_edit", { mode: "tighten", transcript, sources, offsets: sync(0.2) })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/audio-sync's match for \\"camA\\" is too weak to trust/)
    expect(received.body).toBeUndefined()
  })

  it("refuses offsets when a source has no id to match them by", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "plan_edit", {
      mode: "tighten", transcript, sources: [sources[0], { url: "https://a/camA.mp4" }], offsets: sync(0.9),
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/give every source the `id` you gave audio_sync/)
    expect(received.body).toBeUndefined()
  })

  it("without offsets, unnamed sources stay unnamed (the plugin mints their ids)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "j-ep3" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "plan_edit", { mode: "tighten", transcript, sources: [{ url: "https://a/ep.mp4" }] })
    expect(received.body?.sources).toEqual([{ url: "https://a/ep.mp4" }])
  })
})

describe("mix_audio verb", () => {
  const tracks = [{ audio_url: "https://a/voice.mp3" }, { audio_url: "https://a/bed.mp3" }]

  it("calls /v1/mix-audio with the urls in track order", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-mix" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "mix_audio", { tracks })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-mix")
    expect(received.body?.audioUrls).toEqual(["https://a/voice.mp3", "https://a/bed.mp3"])
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("sends neither trackVolumes nor duck when none is asked for (a plain mix)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-plain" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "mix_audio", { tracks })
    expect(received.body && "trackVolumes" in received.body).toBe(false)
    expect(received.body && "duck" in received.body).toBe(false)
  })

  it("sends per-track volumes positionally, defaulting an unset one to 100", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-vol" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "mix_audio", {
      tracks: [{ audio_url: "https://a/voice.mp3" }, { audio_url: "https://a/bed.mp3", volume: 40 }],
    })
    expect(received.body?.trackVolumes).toEqual([100, 40])
  })

  it("maps duck to the route's camelCase levers", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-duck" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "mix_audio", {
      tracks,
      duck: { under: 0, amount: 80, threshold_db: -35, ratio: 6, attack_ms: 10, release_ms: 700 },
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.duck).toEqual({ under: 0, amount: 80, thresholdDb: -35, ratio: 6, attackMs: 10, releaseMs: 700 })
  })

  it("sends only the levers that were given", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-duck2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "mix_audio", { tracks, duck: { under: 0 } })
    expect(received.body?.duck).toEqual({ under: 0 })
  })

  it("refuses a duck.under that is not one of the tracks, naming the range, without calling the route", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-bad" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "mix_audio", { tracks, duck: { under: 2 } })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/duck\.under.*0.*1/)
    expect(received.body).toBeUndefined()
  })

  it("returns isError if a track has neither audio_url nor audio_asset_id", async () => {
    const { fastify } = stubRoute("POST", "/v1/mix-audio", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "mix_audio", { tracks: [{ audio_url: "https://a/a.mp3" }, {}] })
    expect(result.isError).toBe(true)
  })

  it("rejects fewer than two tracks, and levers outside the compressor's range", async () => {
    const { fastify } = stubRoute("POST", "/v1/mix-audio", { jobId: "j" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    expect((await callTool(server, "mix_audio", { tracks: [tracks[0]] })).isError).toBe(true)
    expect((await callTool(server, "mix_audio", { tracks, duck: { under: 0, amount: 101 } })).isError).toBe(true)
    expect((await callTool(server, "mix_audio", { tracks, duck: { under: 0, ratio: 25 } })).isError).toBe(true)
  })

  it("returns isError when /v1/mix-audio responds 402 (the credit guard's refusal reaches the caller)", async () => {
    const fastify = Fastify()
    fastify.post("/v1/mix-audio", async (_req, reply) =>
      reply.status(402).send({ error: { code: "insufficient_credits", message: "Not enough credits" } }),
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "mix_audio", { tracks })
    expect(result.isError).toBe(true)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("mix_audio")
  })
})

describe("apply_edl verb", () => {
  const validEdl = {
    version: 1,
    clock: "master",
    sources: [{ id: "s1", url: "https://a/v.mp4", kind: "video" }],
    segments: [{ id: "seg1", inMs: 0, outMs: 2000, video: "s1" }],
  }

  it("calls /v1/apply-edl with a valid EDL object + snake_case → camelCase", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-ae" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "apply_edl", {
      edl: validEdl,
      output: "video",
      crossfade_ms: 100,
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-ae")
    expect((received.body?.edl as Record<string, unknown>)?.clock).toBe("master")
    expect(received.body?.output).toBe("video")
    expect(received.body?.crossfadeMs).toBe(100)
    expect(received.body?.mcp_client).toBe("Claude")
    expect(received.body?.userId).toBe("u1")
  })

  it("passes quality and clip_key through as quality + clipKey (the render's result identity)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-ae-ck" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "apply_edl", { edl: validEdl, quality: "proxy", clip_key: "0-2000" })

    expect(result.isError).toBeUndefined()
    expect(received.body?.quality).toBe("proxy")
    expect(received.body?.clipKey).toBe("0-2000")
    expect(received.body).not.toHaveProperty("clip_key")
  })

  it("refuses a clip_key that is not '<first inMs>-<last outMs>', never dispatching", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-ae-bad-ck" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "apply_edl", { edl: validEdl, clip_key: "clip-1" })

    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("accepts a JSON-STRING EDL (client serialization slip) and dispatches", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-ae-str" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "apply_edl", { edl: JSON.stringify(validEdl) })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-ae-str")
    // The verb parses the string before dispatch, so the route receives an object.
    expect((received.body?.edl as Record<string, unknown>)?.clock).toBe("master")
  })

  it("returns an honest isError for an unparseable JSON-string EDL (not 'segments is empty')", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-badstr" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "apply_edl", { edl: "{not valid json" })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("not valid JSON")
    expect((result.content[0] as { text: string }).text).not.toContain("segments is empty")
    expect(received.body).toBeUndefined()
  })

  it("pre-validates and returns isError NAMING the segment + rule, never dispatching", async () => {
    // A video render with a picture-less segment: the route would 400, but the
    // MCP error formatter drops issues[] — so the verb pre-validates and surfaces
    // the offending segment id + rule itself.
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-bad" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const badEdl = {
      version: 1,
      clock: "master",
      sources: [{ id: "s1", url: "https://a/v.mp4", kind: "video" }],
      segments: [{ id: "seg1", inMs: 0, outMs: 2000 }], // no video source
    }
    const result = await callTool(server, "apply_edl", { edl: badEdl, output: "video" })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("seg1")
    expect((result.content[0] as { text: string }).text).toContain("video source")
    expect(received.body).toBeUndefined() // never dispatched
  })

  it("refuses an edit over the 3-hour output cap, naming the length and the cap, never dispatching", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/apply-edl", { jobId: "j-long" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const longEdl = { ...validEdl, segments: [{ id: "seg1", inMs: 0, outMs: 200 * 60_000, video: "s1" }] }
    const result = await callTool(server, "apply_edl", { edl: longEdl })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      "the edit renders 200 minutes of output — over the 180-minute limit for one render",
    )
    expect(received.body).toBeUndefined() // never dispatched → nothing reserved
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerVerbs({ server, session: readOnlySession(), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("apply_edl")
  })
})

describe("image_collage verb", () => {
  it("forwards per-image labels + numbered as index-aligned imageLabels + numbered to /v1/image-collage", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-collage", { jobId: "j-collage" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "image_collage", {
      images: [
        { url: "https://x/a.png", label: "Wide" },
        { url: "https://x/b.png" },
        { url: "https://x/c.png", label: "  Close-up  " },
      ],
      numbered: true,
      badge_position: "top-right",
    })

    expect(result.isError).toBeUndefined()
    // Labels align by position (trimmed); a blank/absent label becomes null.
    expect(received.body?.imageLabels).toEqual(["Wide", null, "Close-up"])
    expect(received.body?.numbered).toBe(true)
    expect(received.body?.badgePosition).toBe("top-right")
    expect(received.body?.imageUrls).toEqual(["https://x/a.png", "https://x/b.png", "https://x/c.png"])
  })

  it("omits imageLabels + numbered when no label is given and numbered is off", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-collage", { jobId: "j-collage2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "image_collage", {
      images: [{ url: "https://x/a.png" }, { url: "https://x/b.png", label: "   " }],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.imageLabels).toBeUndefined()
    expect(received.body?.numbered).toBeUndefined()
    // No badge_position → the route's own default applies; nothing is sent.
    expect(received.body?.badgePosition).toBeUndefined()
  })
})

// ── Audit 2026-09-06 follow-ups (A-14 / C-5): model facts derive, wrong-action strings go ──
describe("audit follow-ups — descriptions tell the truth", () => {
  it("extract_frame: time_seconds without a mode sends mode 'timestamp' (C-5 #8)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/extract-frame", { jobId: "j-ef2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "extract_frame", { video_url: "https://a/v.mp4", time_seconds: 4.2 })
    expect(result.isError).toBeUndefined()
    expect(received.body?.mode).toBe("timestamp")
    expect(received.body?.timestamp).toBe(4.2)
  })

  it("lip_sync's model parameter lists every LIP_SYNC_PROVIDERS id (A-14)", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "lip_sync")
    const desc = ((tool?.inputSchema as { properties?: Record<string, { description?: string }> }).properties?.model?.description) ?? ""
    for (const id of LIP_SYNC_PROVIDERS) expect(desc, id).toContain(id)
  })

  it("modify_video's model parameter lists every VIDEO_TO_VIDEO_PROVIDERS id (A-14)", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "modify_video")
    const desc = ((tool?.inputSchema as { properties?: Record<string, { description?: string }> }).properties?.model?.description) ?? ""
    for (const id of VIDEO_TO_VIDEO_PROVIDERS) expect(desc, id).toContain(id)
  })

  it("modify_image's model parameter no longer sends identity edits to flux-kontext (C-5 #3)", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "modify_image")
    const desc = ((tool?.inputSchema as { properties?: Record<string, { description?: string }> }).properties?.model?.description) ?? ""
    expect(desc).not.toContain("use flux-kontext")
  })

  it("generate_speech never promises a text length its own schema forbids (C-5 #7)", async () => {
    // Was: the description must not contain "10,000" — true while every model was
    // capped at 5,000 and the schema stopped there. The invariant underneath is
    // that no figure the description states exceeds what `text` accepts; v4 takes
    // 10,000, so the schema allows it and the description may say so.
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "generate_speech")
    const maxLength = ((tool?.inputSchema as { properties?: Record<string, { maxLength?: number }> }).properties?.text?.maxLength) ?? 0
    const stated = [...JSON.stringify(tool).matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)].map((m) => Number(m[0].replace(/,/g, "")))
    expect(stated.length).toBeGreaterThan(0)
    for (const n of stated) expect(n, `the description states ${n} but text stops at ${maxLength}`).toBeLessThanOrEqual(maxLength)
    // …and the schema lets v4 use its whole cap.
    expect(maxLength).toBeGreaterThanOrEqual(getMaxTtsChars("elevenlabs-v4"))
  })

  it("generate_speech's copy names the model the handler defaults to — and no other — as the default", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "generate_speech")
    const modelDesc = ((tool?.inputSchema as { properties?: Record<string, { description?: string }> }).properties?.model?.description) ?? ""
    for (const copy of [tool?.description ?? "", modelDesc]) {
      expect(copy).toContain(`\`${DEFAULT_TTS_PROVIDER}\` (default)`)
      expect(copy).not.toMatch(/`elevenlabs-v3` \(default\)|Default `elevenlabs-v3`/)
      expect(copy).not.toMatch(/switch away from v3/)
    }
  })
})
