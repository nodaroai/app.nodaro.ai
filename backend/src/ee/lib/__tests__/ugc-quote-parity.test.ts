import Fastify, { type FastifyInstance } from "fastify"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Parity: for every tool the UGC quote prices, the id (and, for a computed
 * price, the base) the quote derives must equal what the ROUTE reserves for the
 * payload the MCP VERB actually dispatches. Both halves run for real: the verb
 * posts to a capturing stub, and that exact body is replayed into the real
 * route, whose credit guard is replaced by a recorder. A verb that changes an
 * injected default, or a route that changes its reservation id, fails here.
 */
const guard = vi.hoisted(() => ({ id: undefined as string | undefined, base: undefined as number | undefined }))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (resolve: (req: unknown) => string, opts?: { computeCredits?: (body: unknown, req: unknown) => number | Promise<number> }) =>
    async (req: { body: unknown }, reply: { status(code: number): { send(body: unknown): unknown } }) => {
      guard.id = resolve(req)
      guard.base = opts?.computeCredits ? await opts.computeCredits(req.body, req) : undefined
      return reply.status(299).send({ recorded: true })
    },
  reserveCreditsForJob: vi.fn(),
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn() },
  redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn(), ttl: vi.fn().mockResolvedValue(60) },
}))
// `model_pricing` has no admin rows here, so every price falls back to
// STATIC_CREDIT_COSTS exactly as it does for an id with no admin row. Answering
// it with the generic row below would hand `getModelCreditBaseCost` a truthy
// row with no `credit_cost`, and a computed route's base would read `undefined`.
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) =>
      table === "model_pricing"
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: "none" } }) }) }) }
        : {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { mcp_preferences: {} }, error: null }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          },
  },
}))

const { pricingFor } = await import("../ugc-quote.js")
const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
const { registerVerbs } = await import("@/lib/mcp/tools/verbs.js")
const { buildServer, callTool, executeSession } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
const { textToVideoRoutes } = await import("@/routes/text-to-video.js")
const { textToSpeechRoutes } = await import("@/routes/text-to-speech.js")
const { extractFrameRoutes } = await import("@/routes/extract-frame.js")
const { imageCollageRoutes } = await import("@/routes/image-collage.js")
const { imageToTextRoutes } = await import("@/routes/image-to-text.js")
const { combineVideosRoutes } = await import("@/routes/combine-videos.js")
const { forcedAlignmentRoutes } = await import("@/routes/forced-alignment.js")
const { transcribeRoutes } = await import("@/routes/transcribe.js")
const { videoOverlayRoutes } = await import("@/routes/video-overlay.js")
const { addCaptionsRoutes } = await import("@/routes/add-captions.js")
const { silenceDetectRoutes } = await import("@/routes/silence-detect.js")

const URLS: Record<string, string> = {
  generate_video: "/v1/text-to-video",
  generate_speech: "/v1/text-to-speech",
  extract_frame: "/v1/extract-frame",
  image_collage: "/v1/image-collage",
  image_to_text: "/v1/image-to-text/describe",
  combine_videos: "/v1/combine-videos",
  forced_alignment: "/v1/forced-alignment",
  transcribe: "/v1/transcribe",
  overlay_images: "/v1/video-overlay",
  add_captions: "/v1/add-captions",
  silence_detect: "/v1/silence-detect",
}

const VIDEO = "https://cdn.example/clip.mp4"
const IMAGE = "https://cdn.example/still.png"

/**
 * `quoted` is what a quote item carries (the builder's args); `added` is what
 * the agent adds before it calls the tool (ids that do not exist at quote time).
 * `computed` marks a route whose guard computes its base, so the amount check
 * below must actually see a number (not pass as undefined === undefined).
 */
const CASES: Array<{ tool: string; quoted: Record<string, unknown>; added: Record<string, unknown>; clipCount?: number; computed?: boolean }> = [
  { tool: "generate_video", computed: true, quoted: { prompt: "a person talks", model: "seedance-2-5", aspect_ratio: "16:9", duration: 8, resolution: "720p", reference_image_urls: [IMAGE, "https://cdn.example/b.png"] }, added: {} },
  { tool: "generate_video", computed: true, quoted: { prompt: "a person talks", model: "seedance-2-5", aspect_ratio: "16:9", duration: 5, resolution: "720p", reference_image_urls: [IMAGE] }, added: { reference_audio_urls: ["https://cdn.example/sound.mp3"] } },
  { tool: "extract_frame", quoted: { mode: "timestamp", time_seconds: 2 }, added: { video_url: VIDEO } },
  { tool: "image_collage", quoted: { resolution: "2K", layout: "grid" }, added: { images: [{ url: IMAGE }, { url: IMAGE }, { url: IMAGE }] } },
  { tool: "image_to_text", quoted: { custom_prompt: "Answer yes or no." }, added: { image_url: IMAGE } },
  { tool: "combine_videos", quoted: { transition: "cut", audio_mode: "keep", smart_cut: false }, added: { videos: [{ url: VIDEO }, { url: VIDEO }] }, clipCount: 2 },
  { tool: "combine_videos", quoted: { transition: "cut", audio_mode: "keep", smart_cut: false }, added: { videos: [{ url: VIDEO }, { url: VIDEO }, { url: VIDEO }] }, clipCount: 3 },
  { tool: "forced_alignment", quoted: {}, added: { audio_url: VIDEO, transcript: "hello there" } },
  { tool: "transcribe", quoted: {}, added: { audio_url: VIDEO } },
  { tool: "overlay_images", quoted: {}, added: { video_url: VIDEO, layers: [{ url: IMAGE, start: 1, end: 2, preset: "card" }] } },
  { tool: "add_captions", quoted: { segments: [{ style: "subtitle" }, { style: "word-highlight" }] }, added: { video_url: VIDEO } },
  { tool: "generate_speech", quoted: { text: "hello there", model: "elevenlabs-v3" }, added: { voice_id: "Rachel" } },
  { tool: "silence_detect", quoted: {}, added: { audio_url: VIDEO } },
]

/** The verb receives `segments` WITH times (the real call's); the quote item carries them without. */
function verbArgs(c: (typeof CASES)[number]): Record<string, unknown> {
  if (c.tool !== "add_captions") return { ...c.quoted, ...c.added }
  const segments = (c.quoted.segments as Array<Record<string, unknown>>).map((s, i) => ({ ...s, start_ms: i * 1000, end_ms: i * 1000 + 1000 }))
  return { ...c.quoted, ...c.added, segments }
}

let captured: { url?: string; body?: Record<string, unknown> }
let verbsFastify: FastifyInstance
let routes: FastifyInstance

beforeAll(async () => {
  verbsFastify = Fastify()
  for (const url of new Set(Object.values(URLS))) {
    verbsFastify.post(url, async (req) => {
      captured = { url: req.url, body: req.body as Record<string, unknown> }
      return { jobId: "job-parity" }
    })
  }
  routes = Fastify({ logger: false })
  for (const plugin of [textToVideoRoutes, textToSpeechRoutes, extractFrameRoutes, imageCollageRoutes, imageToTextRoutes, combineVideosRoutes, forcedAlignmentRoutes, transcribeRoutes, videoOverlayRoutes, addCaptionsRoutes, silenceDetectRoutes]) {
    await routes.register(plugin)
  }
  await routes.ready()
})

beforeEach(() => {
  captured = {}
  guard.id = undefined
  guard.base = undefined
})

describe("the UGC quote reserves what each route reserves", () => {
  it.each(CASES.map((c) => [`${c.tool}${c.clipCount ? ` × ${c.clipCount}` : ""}`, c] as const))("%s", async (_name, c) => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: verbsFastify })
    const result = await callTool(server, c.tool, verbArgs(c))
    expect(result.isError, JSON.stringify(result.content)).toBeUndefined()
    expect(captured.url).toBe(URLS[c.tool])

    const res = await routes.inject({ method: "POST", url: URLS[c.tool]!, payload: captured.body })
    expect(res.statusCode, res.body).toBe(299)

    const quoted = pricingFor(c.tool, c.quoted, { clipCount: c.clipCount ?? 1 })
    expect(quoted?.id).toBe(guard.id)
    if (c.computed) expect(typeof guard.base, "a computed route must yield a base").toBe("number")
    // A quote-side computed base must equal the route's; a route that computes
    // while the quote reads the row must compute exactly that row's base.
    if (quoted?.base !== undefined) expect(guard.base).toBe(quoted.base)
    else if (guard.base !== undefined) expect(guard.base).toBe(STATIC_CREDIT_COSTS[quoted!.id])
  })
})
