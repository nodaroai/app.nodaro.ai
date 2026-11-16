/**
 * generate_text (POST /v1/llm-chat/generate): Generate Text with media to
 * read, answered whole in the call's own result. A call still running after
 * its wait answers with its job id instead (an MCP client cuts a longer call
 * off), and the route goes on. Listed beside image_to_text, unlisted while the
 * deployment does not offer the Generate Text node.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { announceCreatedJob } from "../../../job-submission-context.js"
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
const { GENERATE_TEXT_INLINE_WAIT_MS, setGenerateTextWaitsForTesting } = await import("../verbs-generate-text.js")

beforeEach(() => {
  _resetRegistry()
  h.denied = new Set()
  h.resolves = []
})
afterEach(() => setGenerateTextWaitsForTesting(null))

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
    expect(result.structuredContent).toEqual({ jobId: "j-text", status: "completed", text: "Four." })
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

  describe("a call that outlasts the wait", () => {
    /**
     * A Generate Text route that creates "j-slow" and answers only when
     * released. `announceAfterMs`: when it tells its caller the job (0 = at
     * once, null = never, as a call still waiting for its slot).
     */
    function slowRoute(announceAfterMs: number | null) {
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const state = { finished: false }
      const fastify = Fastify()
      fastify.addHook("preHandler", async (req) => {
        ;(req as { userId?: string }).userId = req.headers["x-internal-user-id"] as string
      })
      fastify.post("/v1/llm-chat/generate", async (req) => {
        if (announceAfterMs !== null) {
          if (announceAfterMs > 0) await new Promise((r) => setTimeout(r, announceAfterMs))
          announceCreatedJob(req, "j-slow")
        }
        await held
        state.finished = true
        return { jobId: "j-slow", generatedText: "The late answer." }
      })
      return { fastify: fastify as unknown as FastifyInstance, release: () => release(), state }
    }

    it("waits 40 s for the answer in production", () => {
      // Under the 45 s wait_for_job waits, itself under the 60 s an MCP client gives a call.
      expect(GENERATE_TEXT_INLINE_WAIT_MS).toBe(40_000)
    })

    it("answers with the job id while the call is still running, and the route goes on to finish", async () => {
      setGenerateTextWaitsForTesting({ inlineMs: 40, startGraceMs: 40 })
      const { fastify, release, state } = slowRoute(0)
      const result = await callTool(serverWith(fastify), "generate_text", { prompt: "List every defect.", video_urls: ["https://cdn.example/cut.mp4"] })
      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toEqual({ jobId: "j-slow", status: "running" })
      const text = result.content[0]?.text ?? ""
      expect(text).toContain('wait_for_job { job_id: "j-slow" }')
      expect(text).toContain("outputData.generatedText")
      expect(text).toContain("Do not call generate_text again")
      // The tool has answered; the call it made is still the route's to finish.
      expect(state.finished).toBe(false)
      release()
      await expect.poll(() => state.finished).toBe(true)
    })

    it("an answer inside the wait is still the whole answer, with no hand-off", async () => {
      setGenerateTextWaitsForTesting({ inlineMs: 2_000, startGraceMs: 40 })
      const { fastify, release } = slowRoute(0)
      setTimeout(release, 30)
      const result = await callTool(serverWith(fastify), "generate_text", { prompt: "p" })
      expect(result.structuredContent).toEqual({ jobId: "j-slow", status: "completed", text: "The late answer." })
      expect(result.content).toEqual([{ type: "text", text: "The late answer." }])
    })

    it("a job created after the wait, inside the grace, is handed on", async () => {
      setGenerateTextWaitsForTesting({ inlineMs: 30, startGraceMs: 2_000 })
      const { fastify, release } = slowRoute(80)
      const result = await callTool(serverWith(fastify), "generate_text", { prompt: "p" })
      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toEqual({ jobId: "j-slow", status: "running" })
      release()
    })

    it("an answer that arrives inside the grace is returned whole", async () => {
      setGenerateTextWaitsForTesting({ inlineMs: 30, startGraceMs: 2_000 })
      const { fastify, release } = slowRoute(null)
      setTimeout(release, 80)
      const result = await callTool(serverWith(fastify), "generate_text", { prompt: "p" })
      expect(result.structuredContent).toEqual({ jobId: "j-slow", status: "completed", text: "The late answer." })
    })

    it("no job by the end of the grace: says the call has not started and runs once, never an empty success", async () => {
      setGenerateTextWaitsForTesting({ inlineMs: 30, startGraceMs: 30 })
      const { fastify, release, state } = slowRoute(null)
      const result = await callTool(serverWith(fastify), "generate_text", { prompt: "p" })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toBeUndefined()
      const text = result.content[0]?.text ?? ""
      expect(text).toContain("has not started yet")
      expect(text).toContain("Do not call it again")
      expect(text).toContain('list_jobs { types: ["llm-chat"] }')
      release()
      await expect.poll(() => state.finished).toBe(true)
    })

    it("a refusal that arrives after the hand-off harms nothing: the job carries its own outcome", async () => {
      setGenerateTextWaitsForTesting({ inlineMs: 30, startGraceMs: 30 })
      let fail: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        fail = resolve
      })
      const fastify = Fastify()
      fastify.addHook("preHandler", async (req) => {
        ;(req as { userId?: string }).userId = req.headers["x-internal-user-id"] as string
      })
      fastify.post("/v1/llm-chat/generate", async (req, reply) => {
        announceCreatedJob(req, "j-fails")
        await held
        return reply.status(502).send({ error: { code: "llm_error", message: "The model did not answer." } })
      })
      const result = await callTool(serverWith(fastify as unknown as FastifyInstance), "generate_text", { prompt: "p" })
      expect(result.structuredContent).toEqual({ jobId: "j-fails", status: "running" })
      fail()
      // Nothing to assert on the late 502 but that it throws nowhere: a tick for it to land.
      await new Promise((r) => setTimeout(r, 20))
    })
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
