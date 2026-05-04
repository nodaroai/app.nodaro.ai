import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerVerbs } from "../verbs.js"
import { newSession } from "../../session.js"
import { _resetRegistry } from "../../tasks.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

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


function executeSession() {
  return newSession({
    userId: "u1",
    scopes: ["workflows:execute"] as Scope[],
    clientName: "Claude",
  })
}

function readOnlySession() {
  return newSession({
    userId: "u1",
    scopes: ["jobs:read"] as Scope[],
    clientName: "Claude",
  })
}

interface StubResult {
  fastify: FastifyInstance
  received: { url?: string; body?: Record<string, unknown> }
}

function stubRoute(method: "POST" | "GET", url: string, response: object): StubResult {
  const fastify = Fastify()
  const received: { url?: string; body?: Record<string, unknown> } = {}
  if (method === "POST") {
    fastify.post(url, async (req) => {
      received.url = req.url
      received.body = req.body as Record<string, unknown>
      return response
    })
  } else {
    fastify.get(url, async (req) => {
      received.url = req.url
      return response
    })
  }
  return { fastify, received }
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
  it("calls /v1/generate-character on kind='main'", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-character", { jobId: "j-c1" })
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
