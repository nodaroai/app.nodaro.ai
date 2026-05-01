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
