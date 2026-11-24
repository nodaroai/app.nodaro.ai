import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { buildServer, callTool, executeSession, listTools } from "./_helpers.js"

/**
 * `relight_video` and `replace_video_span` price a run before it starts:
 * `estimate_only: true` posts the SAME body the run would post to
 * POST /v1/quote under the node's type and starts nothing; a refusal of the
 * quote is a tool error carrying the route's sentence.
 */

const VIDEO_JOB = "11111111-1111-4111-8111-111111111111"
const VIDEO_URL = "https://cdn.nodaro.ai/videos/clip.mp4"

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: table === "jobs" && id === VIDEO_JOB ? { id, user_id: "u1", job_type: "image-to-video", output_data: { videoUrl: VIDEO_URL } } : null,
            error: null,
          }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

let credits = true
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})

/** The deployment's own unit, when a case sets one (lib/billing-display-unit.ts). */
let unit: { label: string; rate: number; decimals: number } | null = null
vi.mock("../../../billing-display-unit.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, configuredDisplayUnit: () => unit }
})

const { registerVideoVerbs } = await import("../verbs-video.js")
const { _resetRegistry } = await import("../../tasks.js")

interface Calls {
  quote: Array<Record<string, unknown>>
  run: Array<Record<string, unknown>>
}

/** An app with the quote route and one run route; `quote` is what the quote answers. */
function app(runUrl: string, quote: { status: number; body: object }): { fastify: FastifyInstance; calls: Calls } {
  const fastify = Fastify()
  const calls: Calls = { quote: [], run: [] }
  fastify.post("/v1/quote", async (req, reply) => {
    calls.quote.push(req.body as Record<string, unknown>)
    return reply.status(quote.status).send(quote.body)
  })
  fastify.post(runUrl, async (req) => {
    calls.run.push(req.body as Record<string, unknown>)
    return { jobId: "j-1" }
  })
  return { fastify, calls }
}

function setup(runUrl: string, quote: { status: number; body: object } = { status: 200, body: { data: { identifier: "x", reserve: 4321, adjustments: [], warnings: [] } } }) {
  const { fastify, calls } = app(runUrl, quote)
  const server = buildServer()
  registerVideoVerbs({ server, session: executeSession(), fastify })
  return { server, calls }
}

const textOf = (res: { content: Array<{ type: string; text?: string }> }): string => res.content.map((c) => c.text ?? "").join("\n")

beforeEach(() => {
  credits = true
  unit = null
  _resetRegistry()
})

describe("relight_video estimate_only", () => {
  const args = { video_url: VIDEO_URL, prompt: "golden hour", max_resolution: "720", seed: 7 }

  it("posts the run's own body to the quote as switchx and starts no job", async () => {
    const { server, calls } = setup("/v1/switchx")
    const res = await callTool(server, "relight_video", { ...args, estimate_only: true })
    expect(res.isError, textOf(res)).toBeFalsy()
    expect(calls.run).toEqual([])
    expect(calls.quote).toHaveLength(1)
    expect(calls.quote[0]!.type).toBe("switchx")

    // The body an actual run posts, on the same arguments.
    const run = setup("/v1/switchx")
    await callTool(run.server, "relight_video", args)
    expect(run.calls.quote).toEqual([])
    expect(run.calls.run).toHaveLength(1)
    expect(calls.quote[0]!.params).toEqual(run.calls.run[0])
    expect(run.calls.run[0]).toMatchObject({ videoUrl: VIDEO_URL, alphaMode: "auto", maxResolution: 720, prompt: "golden hour", seed: 7 })

    expect(textOf(res)).toContain("Relight & Switch would reserve 4321 credits.")
    expect(textOf(res)).toContain("Nothing was created or charged; call relight_video without estimate_only to run it.")
    expect(textOf(res)).not.toContain("the most this run can cost")
    expect(res.structuredContent).toEqual({ estimate: { reserveCredits: 4321, mostItCanCost: false, adjustments: [], warnings: [] } })
  })

  it("states what the quote expects and what it adjusted", async () => {
    const { server } = setup("/v1/switchx", {
      status: 200,
      body: { data: { identifier: "x", reserve: 4321, expected: 3210, adjustments: [{ code: "params_adjusted", message: "The clip is trimmed to 240 frames." }], warnings: [] } },
    })
    const res = await callTool(server, "relight_video", { ...args, estimate_only: true })
    expect(textOf(res)).toContain("would reserve 4321 credits; expected to cost 3210 credits.")
    expect(textOf(res)).toContain("The clip is trimmed to 240 frames.")
    expect((res.structuredContent as { estimate: Record<string, unknown> }).estimate).toMatchObject({ reserveCredits: 4321, expectedCredits: 3210 })
  })

  it("states every figure in the deployment's own unit, never raw credits", async () => {
    unit = { label: "tokens", rate: 0.01, decimals: 2 }
    const { server } = setup("/v1/switchx", {
      status: 200,
      body: { data: { identifier: "x", reserve: 4321, expected: 3210, adjustments: [{ code: "a", message: "An adjustment.", credits: 1100 }], warnings: [] } },
    })
    const res = await callTool(server, "relight_video", { ...args, estimate_only: true })
    expect(textOf(res)).toContain("would reserve 43.21 tokens; expected to cost 32.1 tokens.")
    expect(textOf(res)).not.toMatch(/4321|3210|credits/)
    expect(res.structuredContent).toEqual({
      estimate: {
        reserveCredits: 43.21,
        expectedCredits: 32.1,
        mostItCanCost: false,
        adjustments: [{ code: "a", message: "An adjustment.", credits: 11 }],
        warnings: [],
        unit: "tokens",
        decimals: 2,
      },
    })
  })

  it.each([
    ["VIDEO_TOO_MANY_FRAMES", "This clip has 300 frames; Relight & Switch takes up to 240."],
    ["MISSING_ALPHA", "Select mode needs a mask image."],
  ])("a quote refused with %s is a tool error carrying its sentence", async (code, message) => {
    const { server, calls } = setup("/v1/switchx", { status: 400, body: { error: { code, message } } })
    const res = await callTool(server, "relight_video", { ...args, estimate_only: true })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain(code)
    expect(textOf(res)).toContain(message)
    expect(calls.run).toEqual([])
  })

  it("a quote it cannot read is a tool error", async () => {
    const { server } = setup("/v1/switchx", { status: 200, body: { data: {} } })
    const res = await callTool(server, "relight_video", { ...args, estimate_only: true })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("the quote could not be read")
  })

  it("checks its own arguments before the quote, as the run does", async () => {
    const { server, calls } = setup("/v1/switchx")
    const res = await callTool(server, "relight_video", { video_url: VIDEO_URL, estimate_only: true })
    expect(res.isError).toBe(true)
    expect(calls.quote).toEqual([])
  })

  it("on an edition without credits it says so and asks no quote", async () => {
    credits = false
    const { server, calls } = setup("/v1/switchx")
    const res = await callTool(server, "relight_video", { ...args, estimate_only: true })
    expect(res.isError).toBeFalsy()
    expect(textOf(res)).toBe("Relight & Switch: not billed in credits on this edition. Nothing was created or charged.")
    expect(calls.quote).toEqual([])
    expect(calls.run).toEqual([])
  })
})

describe("replace_video_span", () => {
  const MOST = { code: "settles_to_actual", message: "This is the most the edit can cost: the run is charged for what it generates and the rest of the hold is released." }
  const mostQuote = { status: 200, body: { data: { identifier: "x", reserve: 8765, adjustments: [], warnings: [MOST] } } }

  it("runs the edit: the span, the prompt and the settings in the route's names", async () => {
    const { server, calls } = setup("/v1/edit-video-pro")
    const res = await callTool(server, "replace_video_span", {
      video_asset_id: VIDEO_JOB,
      span_start: 2,
      span_end: 9.5,
      prompt: "a dog runs in",
      model: "seedance-2-fast",
      reference_image_urls: ["https://cdn.nodaro.ai/images/dog.png"],
      generate_audio: false,
    })
    expect(res.isError, textOf(res)).toBeFalsy()
    expect(calls.quote).toEqual([])
    expect(calls.run).toEqual([
      {
        videoUrl: VIDEO_URL,
        spanStart: 2,
        spanEnd: 9.5,
        prompt: "a dog runs in",
        provider: "seedance-2-fast",
        referenceImageUrls: ["https://cdn.nodaro.ai/images/dog.png"],
        generateAudio: false,
        mcp_client: "Claude",
        userId: "u1",
      },
    ])
    expect((res.structuredContent as { jobId?: string }).jobId).toBe("j-1")
  })

  it("leaves the model and the sound to the route when they are not given", async () => {
    const { server, calls } = setup("/v1/edit-video-pro")
    await callTool(server, "replace_video_span", { video_url: VIDEO_URL, span_start: 0, span_end: 6, prompt: "rain starts" })
    expect(calls.run[0]).toEqual({ videoUrl: VIDEO_URL, spanStart: 0, spanEnd: 6, prompt: "rain starts", mcp_client: "Claude", userId: "u1" })
  })

  it("estimate_only quotes the same body as edit-video-pro, starts no job, and says it is the most the edit can cost", async () => {
    const { server, calls } = setup("/v1/edit-video-pro", mostQuote)
    const args = { video_url: VIDEO_URL, span_start: 2, span_end: 9.5, prompt: "a dog runs in" }
    const res = await callTool(server, "replace_video_span", { ...args, estimate_only: true })
    expect(res.isError, textOf(res)).toBeFalsy()
    expect(calls.run).toEqual([])
    expect(calls.quote).toEqual([
      { type: "edit-video-pro", params: { videoUrl: VIDEO_URL, spanStart: 2, spanEnd: 9.5, prompt: "a dog runs in", mcp_client: "Claude", userId: "u1" } },
    ])
    expect(textOf(res)).toContain("Edit Video Pro would reserve 8765 credits, the most this run can cost.")
    expect(textOf(res)).toContain(MOST.message)
    expect(textOf(res)).toContain("Nothing was created or charged; call replace_video_span without estimate_only to run it.")
    expect(res.structuredContent).toEqual({ estimate: { reserveCredits: 8765, mostItCanCost: true, adjustments: [], warnings: [MOST] } })
  })

  it("a refused quote is a tool error carrying the route's sentence", async () => {
    const { server, calls } = setup("/v1/edit-video-pro", {
      status: 400,
      body: { error: { code: "span_exceeds_source", message: "The span ends at 40 s but the video is 30 s long." } },
    })
    const res = await callTool(server, "replace_video_span", { video_url: VIDEO_URL, span_start: 20, span_end: 40, prompt: "x", estimate_only: true })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("span_exceeds_source")
    expect(textOf(res)).toContain("The span ends at 40 s but the video is 30 s long.")
    expect(calls.run).toEqual([])
  })

  it("refuses a model the node does not offer before any route", async () => {
    const { server, calls } = setup("/v1/edit-video-pro")
    const heldBack = await callTool(server, "replace_video_span", { video_url: VIDEO_URL, span_start: 0, span_end: 6, prompt: "x", model: "seedance-2-5-flash" })
    expect(heldBack.isError).toBe(true)
    expect(textOf(heldBack)).toContain("seedance-2-5-flash is not offered on Edit Video Pro")
    const unknown = await callTool(server, "replace_video_span", { video_url: VIDEO_URL, span_start: 0, span_end: 6, prompt: "x", model: "kling-3.0" })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toContain("Options: seedance-2,")
    expect(calls.run).toEqual([])
    expect(calls.quote).toEqual([])
  })

  it("needs a video", async () => {
    const { server } = setup("/v1/edit-video-pro")
    const res = await callTool(server, "replace_video_span", { span_start: 0, span_end: 6, prompt: "x" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe("Pass video_url or video_asset_id.")
  })

  it("is registered only where credits are billed", async () => {
    const cloud = (await listTools(setup("/v1/edit-video-pro").server)).map((t) => t.name)
    expect(cloud).toContain("replace_video_span")
    credits = false
    const selfHost = (await listTools(setup("/v1/edit-video-pro").server)).map((t) => t.name)
    expect(selfHost).not.toContain("replace_video_span")
    expect(selfHost).toContain("relight_video")
  })
})
