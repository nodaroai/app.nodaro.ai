/**
 * generate_text (POST /v1/llm-chat/generate): Generate Text with media to
 * read, answered whole in the call's own result. Listed beside image_to_text,
 * unlisted while the deployment does not offer the Generate Text node.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildJudgedServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

const h = vi.hoisted(() => ({ denied: new Set<string>(), resolves: [] as Array<{ assetId: string; expectedKind: string }> }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
}))
vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async (opts: { assetId: string; expectedKind: string }) => {
    h.resolves.push(opts)
    if (opts.assetId === "broken") throw new Error("Asset broken not found")
    return `https://cdn.example/resolved/${opts.assetId}`
  }),
}))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../verbs.js")

beforeEach(() => {
  _resetRegistry()
  h.denied = new Set()
  h.resolves = []
})

function serverWith(fastify?: FastifyInstance, session = executeSession()) {
  // The offer funnel in front, as buildMcpServer installs it: what is withheld is not listed.
  const server = buildJudgedServer()
  registerVerbs({ server, session, fastify: fastify ?? (Fastify() as unknown as FastifyInstance) })
  return server
}

/** A long answer: longer than any preview a job read would cut it to. */
const LONG_ANSWER = Array.from({ length: 400 }, (_, i) => `00:${String(i % 60).padStart(2, "0")} defect ${i}`).join("\n")

describe("generate_text", () => {
  it("posts the prompt alone as { systemPrompt: \"\", userInput } and returns the answer as the result's text", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-text", generatedText: "Four." })
    const result = await callTool(serverWith(fastify), "generate_text", { prompt: "Two plus two?" })
    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: "text", text: "Four." }])
    expect(result.structuredContent).toEqual({ jobId: "j-text", text: "Four." })
    expect(received.body).toEqual({
      systemPrompt: "",
      userInput: "Two plus two?",
      mcp_client: expect.any(String),
      userId: expect.any(String),
    })
  })

  it("returns the whole answer, however long", async () => {
    expect(LONG_ANSWER.length).toBeGreaterThan(5000)
    const { fastify } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-long", generatedText: LONG_ANSWER })
    const result = await callTool(serverWith(fastify), "generate_text", { prompt: "List every defect." })
    expect(result.content[0]?.text).toBe(LONG_ANSWER)
    expect((result.structuredContent as { text: string }).text).toBe(LONG_ANSWER)
  })

  it("sends each kind of media on its own route field: links as they are, Nodaro ids resolved for their kind", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-media", generatedText: "ok" })
    const result = await callTool(serverWith(fastify), "generate_text", {
      prompt: "Compare them.",
      system_prompt: "Answer in one line.",
      image_urls: ["https://cdn.example/a.png", "img-job-1"],
      video_urls: ["vid-job-1"],
      audio_urls: "https://cdn.example/mix.wav",
      file_urls: ["https://cdn.example/brief.pdf"],
    })
    expect(result.isError).toBeUndefined()
    expect(received.body).toMatchObject({
      systemPrompt: "Answer in one line.",
      userInput: "Compare them.",
      referenceImageUrls: ["https://cdn.example/a.png", "https://cdn.example/resolved/img-job-1"],
      referenceVideoUrls: ["https://cdn.example/resolved/vid-job-1"],
      referenceAudioUrls: ["https://cdn.example/mix.wav"],
      referenceFileUrls: ["https://cdn.example/brief.pdf"],
    })
    expect(h.resolves).toEqual([
      expect.objectContaining({ assetId: "img-job-1", expectedKind: "image" }),
      expect.objectContaining({ assetId: "vid-job-1", expectedKind: "video" }),
    ])
  })

  it("an audio file alone is sent as audio, with no video field: the sound is judged on its own", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-audio", generatedText: "The voice is clear." })
    await callTool(serverWith(fastify), "generate_text", { prompt: "Is the voice clear?", audio_urls: ["https://cdn.example/final-mix.wav"], llmModel: "gemini-3.8-flash" })
    const body = received.body as Record<string, unknown>
    expect(body.referenceAudioUrls).toEqual(["https://cdn.example/final-mix.wav"])
    expect(body).not.toHaveProperty("referenceVideoUrls")
    expect(body).not.toHaveProperty("referenceImageUrls")
    expect(body.llmModel).toBe("gemini-3.8-flash")
  })

  it("carries video_fps as referenceVideoFps beside the model's levers, and only when asked", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-fps", generatedText: "ok" })
    const server = serverWith(fastify)
    await callTool(server, "generate_text", { prompt: "Find the morphing hands.", video_urls: ["https://cdn.example/cut.mp4"], video_fps: 4, advanced_mode: true, llmModel: "gemini-3.8-flash" })
    expect(received.body).toMatchObject({ referenceVideoUrls: ["https://cdn.example/cut.mp4"], referenceVideoFps: 4, advancedMode: true, llmModel: "gemini-3.8-flash" })

    await callTool(server, "generate_text", { prompt: "Find the morphing hands.", video_urls: ["https://cdn.example/cut.mp4"] })
    expect(received.body).not.toHaveProperty("referenceVideoFps")
    expect(received.body).not.toHaveProperty("advancedMode")
  })

  it("refuses a frame rate out of range before anything is sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-x", generatedText: "x" })
    const server = serverWith(fastify)
    for (const fps of [0, -1, 25]) {
      const result = await callTool(server, "generate_text", { prompt: "p", video_urls: ["https://cdn.example/v.mp4"], video_fps: fps })
      expect(result.isError, `video_fps ${fps}`).toBe(true)
    }
    expect(received.body).toBeUndefined()
  })

  it("an id that cannot be resolved refuses the whole call, naming it, and sends nothing", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-x", generatedText: "x" })
    const result = await callTool(serverWith(fastify), "generate_text", { prompt: "p", video_urls: ["broken"] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("broken")
    expect(received.body).toBeUndefined()
  })

  it("passes the route's refusal on with its code and its words", async () => {
    const fastify = Fastify()
    fastify.post("/v1/llm-chat/generate", async (_req, reply) =>
      reply.status(400).send({ error: { code: "video_fps_needs_advanced_mode", message: "A video frame rate is carried only by the provider's own API." } }),
    )
    const result = await callTool(serverWith(fastify as unknown as FastifyInstance), "generate_text", { prompt: "p", video_urls: ["https://cdn.example/v.mp4"], video_fps: 3 })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(
      "Nodaro rejected the request (400 video_fps_needs_advanced_mode): A video frame rate is carried only by the provider's own API.",
    )
  })

  it("an answer with no text is a failure, never an empty success", async () => {
    const { fastify } = stubRoute("POST", "/v1/llm-chat/generate", { jobId: "j-empty" })
    const result = await callTool(serverWith(fastify), "generate_text", { prompt: "p" })
    expect(result.isError).toBe(true)
  })

  it("is listed with its media inputs, and unlisted where the deployment does not offer Generate Text", async () => {
    const tools = await listTools(serverWith())
    const tool = tools.find((t) => t.name === "generate_text") as { inputSchema?: { properties?: Record<string, unknown>; required?: string[] } } | undefined
    expect(tool).toBeDefined()
    expect(Object.keys(tool?.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(["prompt", "system_prompt", "image_urls", "video_urls", "audio_urls", "file_urls", "video_fps", "llmModel", "advanced_mode"]),
    )
    expect(tool?.inputSchema?.required).toEqual(["prompt"])

    h.denied = new Set(["llm-chat"])
    const withheld = (await listTools(serverWith())).map((t) => t.name)
    expect(withheld).not.toContain("generate_text")
  })
})
