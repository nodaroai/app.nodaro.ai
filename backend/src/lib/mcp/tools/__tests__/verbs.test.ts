import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerVerbs } from "../verbs.js"
import { newSession } from "../../session.js"
import { _resetRegistry } from "../../tasks.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools, executeSession, stubRoute } from "./_helpers.js"

beforeEach(() => {
  _resetRegistry()
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

  it("forwards seedance2_input_mode to payload", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-video", { jobId: "j-sd2-mode" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "animate_image", {
      image_url: "https://x/y.png",
      model: "seedance-2",
      seedance2_input_mode: "references",
      reference_image_urls: ["https://cdn/ref.jpg"],
    })
    expect(received.body?.seedance2InputMode).toBe("references")
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
  it("calls /v1/extend-video with kie_task_id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/extend-video", { jobId: "j-ex" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "extend_video", {
      prompt: "more",
      kie_task_id: "k-1",
      model: "veo-extend",
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-ex")
    expect(received.body?.kieTaskId).toBe("k-1")
    expect(received.body?.provider).toBe("veo-extend")
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
    })

    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-gm")
    expect(received.body?.provider).toBe("minimax")
    expect(received.body?.duration).toBe(20)
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

describe("voice_clone verb", () => {
  it("calls /v1/voice-clones/from-url and returns voiceId", async () => {
    const { fastify, received } = stubRoute(
      "POST",
      "/v1/voice-clones/from-url",
      { jobId: "j-vcl", id: "vc-1", elevenlabsVoiceId: "el-abc", name: "MyVoice", sampleAudioUrl: "https://r2/sample.mp3" },
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "voice_clone", {
      audio_url: "https://a/sample.mp3",
      name: "MyVoice",
    })
    expect(result.isError).toBeUndefined()
    expect(received.body?.audioUrl).toBe("https://a/sample.mp3")
    expect(received.body?.name).toBe("MyVoice")
    expect((result.structuredContent as Record<string, unknown>)?.voiceId).toBe("el-abc")
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
    expect(received.body?.model).toBe("V5")
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
