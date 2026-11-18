/**
 * `make_podcast_pack`: several podcast tools on one recording, one price
 * (POST /v1/podcast-pack), and its quote (`estimate_only` → POST
 * /v1/podcast-pack/estimate). Each tool's arguments are its run verb's own,
 * without the recording: checked against that verb's shape and made into that
 * verb's body, so a tool in the pack posts what its own verb posts.
 */
import { beforeEach, describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { USE_CASE_NODE_TYPES, usecaseDescriptor } from "@nodaro/render-rules"
import type { Scope } from "../../../scopes.js"
import { statedPrices } from "../../../../ee/billing/stated-prices.js"
import { PODCAST_PACK_RATE_ID, PODCAST_PACK_TOOLS } from "../../../use-case/pack-price.js"
import { newSession } from "../../session.js"
import { buildJudgedServer, buildServer, callTool, judgedOffer, listTools } from "./_helpers.js"

const h = vi.hoisted(() => ({ denied: new Set<string>() }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
}))

const { registerUseCaseVerbs } = await import("../verbs-use-case.js")

beforeEach(() => {
  h.denied = new Set()
})

const PACK_ID = "00000000-0000-4000-8000-0000000000aa"
const STARTED = {
  jobId: PACK_ID,
  tools: [
    { tool: "tighten-episode", jobId: "job-tighten", executionId: "exec-1" },
    { tool: "episode-chapters", jobId: "job-chapters", executionId: "exec-2" },
  ],
  durationSec: 3600,
  units: 240,
}
const QUOTE = { tools: ["tighten-episode", "episode-chapters"], durationSec: 3600, units: 240, credits: 5280 }

type Seen = { url?: string; body?: Record<string, unknown>; headers?: Record<string, unknown>; posts: string[] }

async function setup(opts: { run?: { status: number; body: unknown }; estimate?: { status: number; body: unknown }; start?: { status: number; body: unknown } } = {}) {
  const run = opts.run ?? { status: 202, body: STARTED }
  const estimate = opts.estimate ?? { status: 200, body: { data: QUOTE } }
  const fastify = Fastify()
  const seen: Seen = { posts: [] }
  const capture = (url: string, answer: { status: number; body: unknown }) =>
    fastify.post(url, async (req, reply) => {
      seen.url = url
      seen.body = req.body as Record<string, unknown>
      seen.headers = req.headers as Record<string, unknown>
      seen.posts.push(url)
      return reply.code(answer.status).send(answer.body)
    })
  capture("/v1/podcast-pack", run)
  capture("/v1/podcast-pack/estimate", estimate)
  capture(`/v1/podcast-pack/${PACK_ID}/start`, opts.start ?? { status: 202, body: { jobId: "job-clips", executionId: "exec-clips", tool: "clip-pack" } })
  // Each tool's own run route, so a pack tool's body can be held to its verb's.
  for (const type of USE_CASE_NODE_TYPES) capture(usecaseDescriptor(type).route, { status: 202, body: { jobId: "job-1", executionId: "exec-1" } })
  await fastify.ready()
  // The offer funnel in front, as buildMcpServer installs it, and on the session it builds.
  const server = buildJudgedServer()
  registerUseCaseVerbs({ server, session: newSession({ userId: "u1", scopes: ["workflows:execute"] as Scope[], clientName: "Claude", offer: judgedOffer() }), fastify })
  return { server, seen }
}

const textOf = (res: { content?: unknown }) => JSON.stringify(res.content)
const toolsKeysOf = (tool: { inputSchema?: unknown } | undefined) =>
  Object.keys((tool?.inputSchema as { properties: { tools: { properties: Record<string, unknown> } } }).properties.tools.properties)

describe("make_podcast_pack: registration", () => {
  it("is listed beside the use-case verbs, its `tools` keyed by the pack's tools, each naming its run tool, with the per-15 s price", async () => {
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "make_podcast_pack")
    expect(tool).toBeDefined()
    expect(toolsKeysOf(tool)).toEqual([...PODCAST_PACK_TOOLS])
    const props = (tool?.inputSchema as { properties: { tools: { properties: Record<string, { description?: string }>; additionalProperties?: unknown } } }).properties.tools
    expect(props.properties["episode-chapters"]?.description).toContain("make_chapters")
    expect(props.properties["clip-pack"]?.description).toContain("make_clip_pack")
    expect(props.additionalProperties).toBe(false)
    expect(tool?.description).toContain(`${statedPrices().credits(PODCAST_PACK_RATE_ID)} cr per started 15 s of the recording, every tool included`)
    // The description stays short: the run verbs carry the arguments, docs/mcp/tools.md the rest.
    expect(tool?.description!.length).toBeLessThan(400)
  })

  it("names only the offered tools", async () => {
    h.denied = new Set(["clip-pack"])
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "make_podcast_pack")
    expect(toolsKeysOf(tool)).toEqual(PODCAST_PACK_TOOLS.filter((t) => t !== "clip-pack"))
  })

  it("is not listed where no pack tool is offered, or without workflows:execute", async () => {
    h.denied = new Set(USE_CASE_NODE_TYPES)
    const { server } = await setup()
    expect((await listTools(server)).map((t) => t.name)).not.toContain("make_podcast_pack")
    h.denied = new Set()
    const bare = buildServer()
    registerUseCaseVerbs({ server: bare, session: newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" }), fastify: Fastify() })
    expect((await listTools(bare)).map((t) => t.name)).not.toContain("make_podcast_pack")
  })
})

describe("make_podcast_pack: the request", () => {
  it("posts the recording once, the speakers' names, each tool's own body and the retry token to /v1/podcast-pack", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "make_podcast_pack", {
      media_urls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      master_audio_url: "https://r2/m.wav",
      cameras: { already_synced: true },
      speaker_names: { SPEAKER_00: "Dana" },
      tools: {
        "tighten-episode": { music_url: "https://r2/bed.mp3", caption_style: "karaoke", framing_aspect: "9:16" },
        "episode-chapters": {},
        "clip-pack": { count: 4, framing: { aspect: "1:1", layout: "grid" } },
      },
      client_request_id: "pack-retry-1",
    })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/podcast-pack")
    expect(seen.headers?.["idempotency-key"]).toBe("mcp:pack-retry-1")
    expect(seen.body).toEqual({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { synced: true },
      speakerNames: { SPEAKER_00: "Dana" },
      tools: {
        "tighten-episode": { musicUrl: "https://r2/bed.mp3", captionStyle: "karaoke", framing: { aspect: "9:16", layout: "auto" } },
        "episode-chapters": {},
        "clip-pack": { count: 4, framing: { aspect: "1:1", layout: "grid" } },
      },
      mcp_client: "Claude",
      userId: "u1",
    })
  })

  it.each([
    ["tighten-episode", "tighten_episode", { music_url: "https://r2/bed.mp3", music_duck_amount: 60, output: "audio", plan_tier: "economy" }],
    ["episode-chapters", "make_chapters", { plan_tier: "economy", style_guide: "Short titles" }],
    ["episode-trailer", "make_trailer", { formats: ["16:9", "1:1"], intro_card_url: "https://r2/intro.mp4" }],
    ["clip-pack", "make_clip_pack", { count: 3, framing: null, captions: false }],
    ["speaker-layout", "speaker_layout", { target_aspect: "4:5", emphasis: "border+dim", framing_source: "static" }],
  ] as const)("%s: the body its own verb posts, without the recording", async (type, verb, settings) => {
    const { server, seen } = await setup()
    await callTool(server, verb, { media_url: "https://r2/ep.mp4", ...settings })
    const { mediaUrls: _m, mcp_client: _c, userId: _u, ...own } = seen.body!
    await callTool(server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { [type]: settings } })
    expect(seen.url).toBe("/v1/podcast-pack")
    expect((seen.body!.tools as Record<string, unknown>)[type]).toEqual(own)
    expect(seen.body!.mediaUrls).toEqual(["https://r2/ep.mp4"])
  })

  it("a retry token is never derived: none given, no idempotency-key", async () => {
    const { server, seen } = await setup()
    await callTool(server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { "episode-chapters": {} } })
    expect(seen.headers?.["idempotency-key"]).toBeUndefined()
  })
})

describe("make_podcast_pack: the answer", () => {
  it("names the pack's job and each tool's job, to follow with wait_for_job and continue free with continue_use_case", async () => {
    const { server } = await setup()
    const res = await callTool(server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { "tighten-episode": {}, "episode-chapters": {} } })
    const text = textOf(res)
    expect(text).toContain(`Podcast pack started (job ${PACK_ID}): one price for 2 tool(s) on a 60 min recording.`)
    expect(text).toContain("- Tighten Episode: job job-tighten")
    expect(text).toContain("- Chapters: job job-chapters")
    expect(text).toContain("wait_for_job")
    expect(text).toContain('continue_use_case with its job_id and mode \\"from-failed\\"')
    expect(res.structuredContent).toEqual(STARTED)
  })

  it("a tool that did not start is named with the route's code and words", async () => {
    const notStarted = [{ tool: "clip-pack", error: { code: "nodaro_connection_required", message: "Clip Pack: Connect this install to nodaro.ai.", tool: "clip-pack" } }]
    const { server } = await setup({ run: { status: 202, body: { ...STARTED, notStarted } } })
    const res = await callTool(server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { "tighten-episode": {}, "episode-chapters": {}, "clip-pack": {} } })
    expect(res.isError).toBeFalsy()
    expect(textOf(res)).toContain("- not started (nodaro_connection_required): Clip Pack: Connect this install to nodaro.ai.")
  })

  it("a retried key answers the pack's job alone: its output_data.tools names each tool's job", async () => {
    const { server } = await setup({ run: { status: 202, body: { jobId: PACK_ID, deduped: true } } })
    const res = await callTool(server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { "episode-chapters": {} }, client_request_id: "pack-retry-1" })
    expect(res.isError).toBeFalsy()
    expect(textOf(res)).toContain(`This pack was already started (job ${PACK_ID}): get_job on it lists each tool's job in output_data.tools.`)
  })
})

describe("make_podcast_pack: pack_job_id", () => {
  it("starts, free and once, the one tool its pack paid for that did not start", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "make_podcast_pack", { pack_job_id: PACK_ID, tools: { "clip-pack": {} } })
    expect(res.isError).toBeFalsy()
    expect(seen.posts).toEqual([`/v1/podcast-pack/${PACK_ID}/start`])
    expect(seen.body).toEqual({ tool: "clip-pack" })
    expect(textOf(res)).toContain("clip-pack started under its pack: job job-clips")
    expect(textOf(res)).toContain("continue_use_case")
  })

  it("names exactly one tool: none, or two, is a tool error before any request", async () => {
    const { server, seen } = await setup()
    for (const tools of [{}, { "clip-pack": {}, "episode-chapters": {} }]) {
      const res = await callTool(server, "make_podcast_pack", { pack_job_id: PACK_ID, tools })
      expect(res.isError).toBe(true)
    }
    expect(seen.posts).toEqual([])
  })

  it("the route's refusal comes back as the use-case verbs say it (a pack held for review)", async () => {
    const { server } = await setup({ start: { status: 409, body: { error: { code: "pack_under_review", message: "This pack is under review, so nothing can run under it for now." } } } })
    const res = await callTool(server, "make_podcast_pack", { pack_job_id: PACK_ID, tools: { "clip-pack": {} } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("under review")
  })
})

describe("make_podcast_pack: estimate_only", () => {
  it("posts the same body to /v1/podcast-pack/estimate, starts nothing, and states the price", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "make_podcast_pack", {
      media_url: "https://r2/ep.mp4",
      tools: { "tighten-episode": {}, "episode-chapters": {} },
      estimate_only: true,
      client_request_id: "pack-retry-1",
    })
    expect(res.isError).toBeFalsy()
    expect(seen.posts).toEqual(["/v1/podcast-pack/estimate"])
    expect(seen.headers?.["idempotency-key"]).toBeUndefined()
    expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], tools: { "tighten-episode": {}, "episode-chapters": {} }, mcp_client: "Claude", userId: "u1" })
    expect(textOf(res)).toContain("Podcast pack (Tighten Episode, Chapters) is 5280 credits for a 60 min recording, 240 started 15 s, every tool included.")
    expect(textOf(res)).toContain("Nothing was created or charged")
    expect(res.structuredContent).toEqual(QUOTE)
  })

  it("an edition without credits says so; an unpriced pack says the price could not be read", async () => {
    const free = await setup({ estimate: { status: 200, body: { data: { ...QUOTE, credits: 0 } } } })
    const res = await callTool(free.server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { "episode-chapters": {} }, estimate_only: true })
    expect(textOf(res)).toContain("not billed in credits on this edition")
    const unpriced = await setup({ estimate: { status: 200, body: { data: { ...QUOTE, credits: null } } } })
    const res2 = await callTool(unpriced.server, "make_podcast_pack", { media_url: "https://r2/ep.mp4", tools: { "episode-chapters": {} }, estimate_only: true })
    expect(textOf(res2)).toContain("the price could not be read")
  })
})

describe("make_podcast_pack: refusals", () => {
  const call = async (args: Record<string, unknown>, opts?: Parameters<typeof setup>[0]) => {
    const { server, seen } = await setup(opts)
    return { res: await callTool(server, "make_podcast_pack", args), seen }
  }

  it("an argument a tool's own verb does not take is named, and nothing is posted", async () => {
    const { res, seen } = await call({ media_url: "https://r2/ep.mp4", tools: { "episode-chapters": { formats: ["9:16"] } } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain('does not match make_chapters\'s arguments')
    expect(textOf(res)).toContain("formats")
    expect(seen.posts).toEqual([])
  })

  it("a value the tool's own verb refuses is refused in its words (a format listed twice)", async () => {
    const { res, seen } = await call({ media_url: "https://r2/ep.mp4", tools: { "episode-trailer": { formats: ["9:16", "9:16"] } } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("The format 9:16 is listed twice: name each format once.")
    expect(seen.posts).toEqual([])
  })

  it("a review or a recording inside a tool's arguments is refused, saying why", async () => {
    const review = await call({ media_url: "https://r2/ep.mp4", tools: { "tighten-episode": { review_before_render: true } } })
    expect(review.res.isError).toBe(true)
    expect(textOf(review.res)).toContain("A pack has no review: run tighten_episode on its own to review a preview.")
    const recording = await call({ media_url: "https://r2/ep.mp4", tools: { "clip-pack": { media_url: "https://r2/other.mp4" } } })
    expect(recording.res.isError).toBe(true)
    expect(textOf(recording.res)).toContain("Send the recording and client_request_id once, at the top level.")
    expect([...review.seen.posts, ...recording.seen.posts]).toEqual([])
  })

  it("no tool, or both media_url and media_urls, is a tool error before any request", async () => {
    const none = await call({ media_url: "https://r2/ep.mp4", tools: {} })
    expect(none.res.isError).toBe(true)
    expect(textOf(none.res)).toContain("name at least one tool in `tools`")
    const both = await call({ media_url: "https://r2/a.mp4", media_urls: ["https://r2/b.mp4"], tools: { "episode-chapters": {} } })
    expect(textOf(both.res)).toContain("Pass media_url or media_urls, not both.")
    expect([...none.seen.posts, ...both.seen.posts]).toEqual([])
  })

  it("a withheld tool's key is not taken", async () => {
    h.denied = new Set(["clip-pack"])
    const { res, seen } = await call({ media_url: "https://r2/ep.mp4", tools: { "clip-pack": {} } })
    expect(res.isError).toBe(true)
    expect(seen.posts).toEqual([])
  })

  it("the route's refusals come back as the use-case verbs say them: balance, a run under way, unavailable, a recording not read yet", async () => {
    const tool = { media_url: "https://r2/ep.mp4", tools: { "episode-chapters": {} } }
    const balance = await call(tool, { run: { status: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits. Required: 5280, Available: 100" } } } })
    expect(textOf(balance.res)).toContain("Nodaro: insufficient credits (insufficient_credits)")
    const none = await call(tool, { run: { status: 409, body: { error: { code: "use_case_unavailable", message: "Chapters: not available here.", tool: "episode-chapters" }, jobId: PACK_ID } } })
    expect(none.res.isError).toBe(true)
    expect(textOf(none.res)).toContain(`Nodaro rejected the request (409 use_case_unavailable): Chapters: not available here. (job ${PACK_ID})`)
    const unavailable = await call({ ...tool, estimate_only: true }, { estimate: { status: 503, body: { error: { code: "nodaro_connection_required", message: "Connect this install to nodaro.ai." } } } })
    expect(textOf(unavailable.res)).toContain("Nodaro cannot run this here (503 nodaro_connection_required): Connect this install to nodaro.ai.")
    const forNow = await call(tool, { run: { status: 503, body: { error: { code: "probe_unavailable", message: "Could not read the link just now — run it again." } } } })
    expect(textOf(forNow.res)).toContain("Nodaro: Could not read the link just now — run it again. [probe_unavailable]")
    const denied = await call(tool, { run: { status: 403, body: { error: { code: "node_not_available", message: "Speaker Map is not available to you." } } } })
    expect(denied.res.isError).toBe(true)
    expect(textOf(denied.res)).toContain("node_not_available")
  })
})
