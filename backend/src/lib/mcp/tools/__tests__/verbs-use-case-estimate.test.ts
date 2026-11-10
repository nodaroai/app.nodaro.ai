/**
 * `estimate_use_case`: one quote tool for the podcast use-case nodes. Its
 * `input` is validated against the node's run verb's own arguments and made
 * into that verb's own body, posted to the node's /estimate route — so the
 * quote is for exactly the run the same arguments start.
 */
import { beforeEach, describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { USE_CASE_NODE_TYPES, usecaseDescriptor, usecaseEstimatePath, type UseCaseNodeType } from "@nodaro/render-rules"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { buildServer, callTool, executeSession, listTools } from "./_helpers.js"

const h = vi.hoisted(() => ({ denied: new Set<string>() }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
}))

const { registerUseCaseVerbs } = await import("../verbs-use-case.js")

beforeEach(() => {
  h.denied = new Set()
})

const QUOTE = { totalCredits: 846, stepsCredits: 835, feeCredits: 11, durationSec: 3600 }

/** Each node's run tool and arguments of its own (the recording included). */
const RUNS: ReadonlyArray<readonly [UseCaseNodeType, string, Record<string, unknown>]> = [
  ["tighten-episode", "tighten_episode", { media_url: "https://r2/ep.mp4", music_url: "https://r2/bed.mp3", music_duck_amount: 60, caption_style: "karaoke", review_before_render: true }],
  ["episode-chapters", "make_chapters", { media_url: "https://r2/ep.mp4", plan_tier: "economy", style_guide: "Short titles" }],
  ["episode-trailer", "make_trailer", { media_urls: ["https://r2/a.mp4", "https://r2/b.mp4"], formats: ["16:9"], review_before_render: true }],
  ["clip-pack", "make_clip_pack", { media_url: "https://r2/ep.mp4", count: 4, framing: { aspect: "1:1", layout: "grid" } }],
  ["speaker-layout", "speaker_layout", { media_url: "https://r2/ep.mp4", target_aspect: "4:5", emphasis: "border+dim" }],
]

async function setup(estimate: { status: number; body: unknown } = { status: 200, body: { data: QUOTE } }) {
  const fastify = Fastify()
  const seen: { url?: string; body?: Record<string, unknown>; posts: number } = { posts: 0 }
  for (const type of USE_CASE_NODE_TYPES) {
    fastify.post(usecaseDescriptor(type).route, async (req, reply) => {
      seen.url = usecaseDescriptor(type).route
      seen.body = req.body as Record<string, unknown>
      seen.posts++
      return reply.code(202).send({ jobId: "job-1", executionId: "exec-1" })
    })
    fastify.post(usecaseEstimatePath(type), async (req, reply) => {
      seen.url = usecaseEstimatePath(type)
      seen.body = req.body as Record<string, unknown>
      seen.posts++
      return reply.code(estimate.status).send(estimate.body)
    })
  }
  await fastify.ready()
  const server = buildServer()
  registerUseCaseVerbs({ server, session: executeSession(), fastify })
  return { server, seen }
}

const textOf = (res: { content?: unknown }) => JSON.stringify(res.content)

describe("estimate_use_case: registration", () => {
  it("is listed beside the run verbs, read-only, keyed by the offered node types, naming each run tool", async () => {
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "estimate_use_case")
    expect(tool).toBeDefined()
    expect((tool as { annotations?: unknown } | undefined)?.annotations).toMatchObject({ readOnlyHint: true })
    const nodeType = (tool?.inputSchema as { properties: { node_type: { enum: string[] } } }).properties.node_type
    expect(nodeType.enum).toEqual([...USE_CASE_NODE_TYPES])
    for (const [, run] of RUNS) expect(tool?.description).toContain(run)
  })

  it("names only the offered nodes", async () => {
    h.denied = new Set(["clip-pack"])
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "estimate_use_case")
    const nodeType = (tool?.inputSchema as { properties: { node_type: { enum: string[] } } }).properties.node_type
    expect(nodeType.enum).not.toContain("clip-pack")
    expect(tool?.description).not.toContain("make_clip_pack")
  })

  it("is not listed where no use-case node is offered, or without workflows:execute", async () => {
    h.denied = new Set(USE_CASE_NODE_TYPES)
    const { server } = await setup()
    expect((await listTools(server)).map((t) => t.name)).not.toContain("estimate_use_case")
    h.denied = new Set()
    const bare = buildServer()
    registerUseCaseVerbs({ server: bare, session: newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" }), fastify: Fastify() })
    expect((await listTools(bare)).map((t) => t.name)).not.toContain("estimate_use_case")
  })
})

describe("estimate_use_case: the quote", () => {
  it.each(RUNS.map((r) => [r[0], r] as const))("%s: posts the body its run tool posts (without the reviewer) to its /estimate route", async (_type, [type, run, args]) => {
    const { server, seen } = await setup()
    const ran = await callTool(server, run, args)
    expect(ran.isError).toBeFalsy()
    const { reviewerPresent: _reviewer, ...runBody } = seen.body!
    const quoted = await callTool(server, "estimate_use_case", { node_type: type, input: args })
    expect(quoted.isError).toBeFalsy()
    expect(seen.url).toBe(usecaseEstimatePath(type))
    expect(seen.body).toEqual(runBody)
    expect(quoted.structuredContent).toEqual({ nodeType: type, ...QUOTE })
  })

  it("says the quote in one sentence: the total, the steps and the fee, the recording's length", async () => {
    const { server } = await setup()
    const res = await callTool(server, "estimate_use_case", { node_type: "speaker-layout", input: { media_url: "https://r2/ep.mp4" } })
    expect(textOf(res)).toContain("Speaker Layout is estimated at 846 credits: its steps 835 plus the per-run fee 11 (the recording is 60 min).")
    expect(textOf(res)).toContain("Nothing was created or charged; speaker_layout starts the run.")
  })

  it("≈ when a step is a metered estimate; an unreadable length is said", async () => {
    const { server } = await setup({ status: 200, body: { data: { ...QUOTE, estimate: true, durationSec: null } } })
    const res = await callTool(server, "estimate_use_case", { node_type: "tighten-episode", input: { media_url: "https://r2/ep.mp4" } })
    expect(textOf(res)).toContain("estimated at ≈846 credits: its steps ≈835")
    expect(textOf(res)).toContain("the recording's length could not be read")
    expect(res.structuredContent).toMatchObject({ estimate: true, durationSec: null })
  })

  it("an edition without credits: said, not quoted", async () => {
    const { server } = await setup({ status: 200, body: { data: { totalCredits: 0, stepsCredits: 0, feeCredits: 0, durationSec: 120 } } })
    const res = await callTool(server, "estimate_use_case", { node_type: "episode-chapters", input: { media_url: "https://r2/ep.mp4" } })
    expect(textOf(res)).toContain("Chapters: not billed in credits on this edition")
  })
})

describe("estimate_use_case: refusals", () => {
  it("an argument the node's run tool does not take is named, and nothing is posted", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "estimate_use_case", { node_type: "episode-chapters", input: { media_url: "https://r2/ep.mp4", formats: ["9:16"] } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("does not match make_chapters's arguments")
    expect(textOf(res)).toContain("formats")
    expect(seen.posts).toBe(0)
  })

  it("a conversation's own arguments (user_request, flow_id) copied into input are let go, not refused", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "estimate_use_case", {
      node_type: "tighten-episode",
      input: { media_url: "https://r2/ep.mp4", user_request: "tighten my episode", flow_id: "new" },
    })
    expect(res.isError).toBeFalsy()
    expect(seen.body).not.toHaveProperty("user_request")
    expect(seen.body).not.toHaveProperty("flow_id")
  })

  it("an argument the run tool refuses is refused in its words (a format listed twice), and nothing is posted", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "estimate_use_case", { node_type: "episode-trailer", input: { media_url: "https://r2/ep.mp4", formats: ["9:16", "9:16"] } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("The format 9:16 is listed twice: name each format once.")
    expect(seen.posts).toBe(0)
  })

  it("the recordings' own refusal: both media_url and media_urls", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "estimate_use_case", { node_type: "tighten-episode", input: { media_url: "https://r2/a.mp4", media_urls: ["https://r2/b.mp4"] } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("Pass media_url or media_urls, not both.")
    expect(seen.posts).toBe(0)
  })

  it("a refusal of the route comes back as a tool error: a 503 in the run verbs' words, a 403 as the route says it", async () => {
    const unavailable = await setup({ status: 503, body: { error: { code: "nodaro_connection_required", message: "Connect this install to nodaro.ai." } } })
    const res = await callTool(unavailable.server, "estimate_use_case", { node_type: "tighten-episode", input: { media_url: "https://r2/ep.mp4" } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("Nodaro cannot run this here (503 nodaro_connection_required): Connect this install to nodaro.ai.")
    const denied = await setup({ status: 403, body: { error: { code: "node_not_available", message: "Speaker Map is not available to you." } } })
    const res403 = await callTool(denied.server, "estimate_use_case", { node_type: "episode-trailer", input: { media_urls: ["https://r2/a.mp4", "https://r2/b.mp4"] } })
    expect(res403.isError).toBe(true)
    expect(textOf(res403)).toContain("node_not_available")
  })
})
