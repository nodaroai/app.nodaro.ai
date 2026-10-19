import { beforeEach, describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { buildServer, callTool, executeSession, listTools } from "./_helpers.js"

/** The node types this deployment does not offer, and a builder the use-case rows answer with, for the test at hand. */
const h = vi.hoisted(() => ({ denied: new Set<string>(), builder: undefined as string | undefined }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
}))
vi.mock("@nodaro/render-rules", async (importOriginal) => {
  const real = await importOriginal<typeof import("@nodaro/render-rules")>()
  return {
    ...real,
    usecaseRowOf: (type: Parameters<typeof real.usecaseRowOf>[0]) =>
      h.builder === undefined ? real.usecaseRowOf(type) : { ...real.usecaseRowOf(type), builder: h.builder },
  }
})

const { registerUseCaseVerbs } = await import("../verbs-use-case.js")

beforeEach(() => {
  h.denied = new Set()
  h.builder = undefined
})

const RUN_ID = "00000000-0000-4000-8000-0000000000aa"
const OTHER_ID = "00000000-0000-4000-8000-0000000000bb"

/** The run `GET /v1/jobs/:id` answers by default: a Tighten Episode wrapper, as the run route writes it. */
const TIGHTEN_RUN = { id: RUN_ID, job_type: "tighten-episode", input_data: { type: "tighten-episode", mode: "run" } }

async function setup(
  status = 202,
  body: unknown = { jobId: "job-1", executionId: "exec-1" },
  job: { status: number; body: unknown } = { status: 200, body: { data: TIGHTEN_RUN } },
) {
  const fastify = Fastify()
  const seen: { url?: string; body?: Record<string, unknown>; headers?: Record<string, unknown>; reads: string[] } = { reads: [] }
  fastify.get("/v1/jobs/:id", async (req, reply) => {
    seen.reads.push(req.url)
    return reply.code(job.status).send(job.body)
  })
  for (const url of USE_CASE_NODE_TYPES.flatMap((t) => [usecaseDescriptor(t).route, usecaseContinuePath(t)])) {
    fastify.post(url, async (req, reply) => {
      seen.url = url
      seen.body = req.body as Record<string, unknown>
      seen.headers = req.headers as Record<string, unknown>
      return reply.code(status).send(body)
    })
  }
  await fastify.ready()
  const server = buildServer()
  registerUseCaseVerbs({ server, session: executeSession(), fastify })
  return { server, seen }
}

const textOf = (res: { content?: unknown }) => JSON.stringify(res.content)

describe("registration", () => {
  it("lists every use-case tool under workflows:execute, with the job output schema", async () => {
    const { server } = await setup()
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(["tighten_episode", "make_chapters", "make_trailer", "continue_use_case"]))
  })
  it("names the gap when a built package carries a builder with no MCP verb", () => {
    h.builder = "no-such-builder"
    expect(() => registerUseCaseVerbs({ server: buildServer(), session: executeSession(), fastify: Fastify() })).toThrow(/builder "no-such-builder" has no MCP verb in REGISTER_BY_BUILDER/)
  })
  it("lists neither without workflows:execute", async () => {
    const server = buildServer()
    const session = newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" })
    registerUseCaseVerbs({ server, session, fastify: Fastify() })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).not.toContain("tighten_episode")
    expect(names).not.toContain("make_chapters")
    expect(names).not.toContain("make_trailer")
    expect(names).not.toContain("continue_use_case")
  })
  it("lists none when this deployment offers no use-case node", async () => {
    h.denied = new Set(USE_CASE_NODE_TYPES)
    const { server } = await setup()
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).not.toContain("tighten_episode")
    expect(names).not.toContain("make_chapters")
    expect(names).not.toContain("make_trailer")
    expect(names).not.toContain("continue_use_case")
  })
  it("make_trailer is not listed when the Trailer node is denied; the others still are", async () => {
    h.denied = new Set(["episode-trailer"])
    const { server } = await setup()
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)
    expect(names).not.toContain("make_trailer")
    expect(names).toEqual(expect.arrayContaining(["tighten_episode", "make_chapters", "continue_use_case"]))
    expect(tools.find((t) => t.name === "continue_use_case")?.description).toMatch(/^Continue a Tighten Episode or Chapters run as a NEW job/)
    expect(tools.find((t) => t.name === "continue_use_case")?.description).not.toMatch(/Trailer/)
  })
  it("make_chapters is not listed when the Chapters node is denied; continue_use_case still is, for Tighten Episode", async () => {
    h.denied = new Set(["episode-chapters"])
    const { server } = await setup()
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)
    expect(names).not.toContain("make_chapters")
    expect(names).toEqual(expect.arrayContaining(["tighten_episode", "make_trailer", "continue_use_case"]))
    expect(tools.find((t) => t.name === "continue_use_case")?.description).toMatch(/^Continue a Tighten Episode or Trailer run as a NEW job/)
    expect(tools.find((t) => t.name === "continue_use_case")?.description).not.toMatch(/Chapters/)
  })
  it("tighten_episode is not listed when only Tighten Episode is denied; make_chapters and continue_use_case are", async () => {
    h.denied = new Set(["tighten-episode"])
    const { server } = await setup()
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)
    expect(names).not.toContain("tighten_episode")
    expect(names).toEqual(expect.arrayContaining(["make_chapters", "make_trailer", "continue_use_case"]))
    expect(tools.find((t) => t.name === "continue_use_case")?.description).toMatch(/^Continue a Chapters or Trailer run as a NEW job/)
  })
  it("continue_use_case names the use-case nodes this deployment offers", async () => {
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "continue_use_case")
    expect(tool?.description).toMatch(/^Continue a Tighten Episode, Chapters or Trailer run as a NEW job \(see `mode`\)/)
    expect(tool?.description).toMatch(/Render final applies only to a run made with a review \(`review_before_render`\); Chapters has none\./)
  })
  it("says a layout without an aspect is ignored, and what each continue mode does", async () => {
    const { server } = await setup()
    const tools = await listTools(server)
    const schemaOf = (name: string) => JSON.stringify(tools.find((t) => t.name === name)?.inputSchema)
    expect(schemaOf("tighten_episode")).toMatch(/framing_layout[^}]*Ignored without framing_aspect/)
    expect(schemaOf("continue_use_case")).toMatch(/from-failed[^"]*fee/)
    expect(schemaOf("continue_use_case")).toMatch(/render-final[^"]*no fee/)
  })
})

describe("tighten_episode", () => {
  it("posts the recording and settings camelCased, with the client's idempotency key", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "tighten_episode", {
      media_url: "https://r2/ep.mp4",
      music_url: "https://r2/bed.mp3",
      captions: false,
      review_before_render: true,
      plan_tier: "premium",
      framing_aspect: "9:16",
      client_request_id: "req-123456",
    })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/tighten-episode")
    expect(seen.body).toMatchObject({
      mediaUrls: ["https://r2/ep.mp4"],
      musicUrl: "https://r2/bed.mp3",
      captions: false,
      reviewBeforeRender: true,
      // The agent that asked for the review is its reviewer.
      reviewerPresent: true,
      planTier: "premium",
      framing: { aspect: "9:16", layout: "auto" },
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(seen.headers?.["idempotency-key"]).toBe("mcp:req-123456")
    expect(textOf(res)).toContain("job-1")
  })

  it("sends only what the caller set — the route resolves every default", async () => {
    const { server, seen } = await setup()
    await callTool(server, "tighten_episode", { media_url: "https://r2/ep.mp4" })
    expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], mcp_client: "Claude", userId: "u1" })
    expect(seen.headers?.["idempotency-key"]).toBeUndefined()
  })

  it("passes the rest of the settings through, framing layout included", async () => {
    const { server, seen } = await setup()
    await callTool(server, "tighten_episode", {
      media_url: "https://r2/ep.mp4",
      output: "audio",
      framing_aspect: "1:1",
      framing_layout: "side-by-side",
      caption_style: "word-highlight",
      instructions: "Keep the intro.",
      style_guide: "Brisk.",
      music_duck_amount: 40,
    })
    expect(seen.body).toMatchObject({
      output: "audio",
      framing: { aspect: "1:1", layout: "side-by-side" },
      captionStyle: "word-highlight",
      instructions: "Keep the intro.",
      styleGuide: "Brisk.",
      musicDuckAmount: 40,
    })
  })

  it("a keyed retry the route deduplicates answers with the same run", async () => {
    const { server } = await setup(202, { jobId: "job-1", deduped: true })
    const res = await callTool(server, "tighten_episode", { media_url: "https://r2/ep.mp4", client_request_id: "req-123456" })
    expect(res.isError).toBeFalsy()
    expect(textOf(res)).toContain("job-1")
  })

  it("a refusal reaches the agent with its code and message", async () => {
    const { server } = await setup(503, { error: { code: "nodaro_connection_required", message: "This node runs on nodaro.ai." } })
    const res = await callTool(server, "tighten_episode", { media_url: "https://r2/ep.mp4" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(/nodaro\.ai/)
    expect(textOf(res)).toContain("nodaro_connection_required")
  })

  it("a recording the route refuses names the problem", async () => {
    const { server } = await setup(400, { error: { code: "media_too_long", message: "Tighten Episode takes recordings up to 3 hours." } })
    const res = await callTool(server, "tighten_episode", { media_url: "https://r2/ep.mp4" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("media_too_long")
    expect(textOf(res)).toContain("up to 3 hours")
  })

  it("a server error never echoes the body", async () => {
    const { server } = await setup(500, { error: { code: "internal_error", message: "stack trace here" } })
    const res = await callTool(server, "tighten_episode", { media_url: "https://r2/ep.mp4" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).not.toContain("stack trace")
  })
})

describe("make_chapters", () => {
  it("posts the recording and the plan settings to /v1/episode-chapters, with the client's idempotency key", async () => {
    const { server, seen } = await setup(202, { jobId: "00000000-0000-4000-8000-0000000000cc" })
    const res = await callTool(server, "make_chapters", {
      media_url: "https://r2/ep.mp4",
      plan_tier: "standard",
      instructions: "Short titles",
      style_guide: "Title case",
      client_request_id: "req-chapters",
    })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/episode-chapters")
    expect(seen.body).toEqual({
      mediaUrls: ["https://r2/ep.mp4"],
      planTier: "standard",
      instructions: "Short titles",
      styleGuide: "Title case",
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(seen.headers?.["idempotency-key"]).toBe("mcp:req-chapters")
    expect(textOf(res)).toContain("00000000-0000-4000-8000-0000000000cc")
  })

  it("sends only what the caller set — the route resolves every default", async () => {
    const { server, seen } = await setup()
    await callTool(server, "make_chapters", { media_url: "https://r2/ep.mp4" })
    expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], mcp_client: "Claude", userId: "u1" })
  })

  it("says where the show notes and the list are", async () => {
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "make_chapters")
    expect(tool?.description).toMatch(/output_data\.text/)
    expect(tool?.description).toMatch(/output_data\.json/)
    expect(tool?.description).toMatch(/continue_use_case/)
  })

  it("an unconnected install's refusal reaches the agent with its code and message", async () => {
    const { server } = await setup(503, { error: { code: "nodaro_connection_required", message: "This node runs on nodaro.ai." } })
    const res = await callTool(server, "make_chapters", { media_url: "https://r2/ep.mp4" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("nodaro_connection_required")
  })
})

describe("make_trailer", () => {
  it("posts the recording, the intro card, the formats and the plan settings to /v1/episode-trailer", async () => {
    const { server, seen } = await setup(202, { jobId: "00000000-0000-4000-8000-0000000000dd" })
    const res = await callTool(server, "make_trailer", {
      media_url: "https://r2/ep.mp4",
      intro_card_url: "https://r2/card.mp4",
      formats: ["9:16", "16:9"],
      review_before_render: true,
      plan_tier: "premium",
      instructions: "Open on the laugh",
      style_guide: "Brisk",
      client_request_id: "req-trailer",
    })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/episode-trailer")
    expect(seen.body).toEqual({
      mediaUrls: ["https://r2/ep.mp4"],
      introCardUrl: "https://r2/card.mp4",
      formats: ["9:16", "16:9"],
      reviewBeforeRender: true,
      // The agent that asked for the review is its reviewer.
      reviewerPresent: true,
      planTier: "premium",
      instructions: "Open on the laugh",
      styleGuide: "Brisk",
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(seen.headers?.["idempotency-key"]).toBe("mcp:req-trailer")
    expect(textOf(res)).toContain("00000000-0000-4000-8000-0000000000dd")
  })

  it("sends only what the caller set — the route resolves every default; no review, no reviewer", async () => {
    const { server, seen } = await setup()
    await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", review_before_render: false })
    expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], reviewBeforeRender: false, mcp_client: "Claude", userId: "u1" })
  })

  it("an empty format list is refused by the tool, posting nothing", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", formats: [] })
    expect(res.isError).toBe(true)
    expect(seen.url).toBeUndefined()
  })

  it("a repeated format, or more formats than there are, is refused by the tool, posting nothing", async () => {
    const { server, seen } = await setup()
    const dup = await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", formats: ["9:16", "9:16"] })
    expect(dup.isError).toBe(true)
    const five = await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", formats: ["9:16", "1:1", "4:5", "16:9", "9:16"] })
    expect(five.isError).toBe(true)
    expect(seen.url).toBeUndefined()
    const all = await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", formats: ["9:16", "1:1", "4:5", "16:9"] })
    expect(all.isError).toBeFalsy()
    expect(seen.body).toMatchObject({ formats: ["9:16", "1:1", "4:5", "16:9"] })
  })

  it("an unknown format is refused by the tool, posting nothing", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", formats: ["21:9"] })
    expect(res.isError).toBe(true)
    expect(seen.url).toBeUndefined()
  })

  it("says where the trailers are, what a review returns, and how to finish it", async () => {
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "make_trailer")
    expect(tool?.description).toMatch(/output_data\.formats/)
    expect(tool?.description).toMatch(/output_data\.videoUrl/)
    expect(tool?.description).toMatch(/failedFormats/)
    expect(tool?.description).toMatch(/render-final/)
  })

  it("an intro card the route refuses names the problem", async () => {
    const { server } = await setup(400, { error: { code: "intro_card_too_long", message: "The intro card is too long. Use a card of 15 seconds or less." } })
    const res = await callTool(server, "make_trailer", { media_url: "https://r2/ep.mp4", intro_card_url: "https://r2/card.mp4" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("intro_card_too_long")
    expect(textOf(res)).toContain("15 seconds or less")
  })
})

describe("continue_use_case", () => {
  it("posts the job, the mode and the reviewer's edit", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final", edited_edl: { v: 1 } })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/tighten-episode/continue")
    expect(seen.body).toMatchObject({ jobId: RUN_ID, mode: "render-final", editedEdl: { v: 1 }, mcp_client: "Claude", userId: "u1" })
  })

  it("a from-failed continue carries no edit and the client's idempotency key", async () => {
    const { server, seen } = await setup()
    await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed", client_request_id: "req-abcdefg" })
    // The agent continuing its own run is its reviewer (the route reads it only for a review-on run).
    expect(seen.body).toEqual({ jobId: RUN_ID, mode: "from-failed", reviewerPresent: true, mcp_client: "Claude", userId: "u1" })
    expect(seen.headers?.["idempotency-key"]).toBe("mcp:req-abcdefg")
  })

  it("superseded: names the newer run to continue instead", async () => {
    const { server } = await setup(409, {
      error: { code: "continuation_superseded", message: "A later continuation of this run failed: continue that one." },
      jobId: OTHER_ID,
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("continuation_superseded")
    expect(textOf(res)).toContain(OTHER_ID)
    expect(textOf(res)).toMatch(/continue_use_case/)
  })

  it("already running: names the run under way and says to follow it", async () => {
    const { server } = await setup(409, {
      error: { code: "already_running", message: "A Render final of this run is already in progress." },
      jobId: OTHER_ID,
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("already_running")
    expect(textOf(res)).toContain(OTHER_ID)
    expect(textOf(res)).toMatch(/get_job|wait_for_job/)
  })

  it("already rendered: names the render of the same edit", async () => {
    const { server } = await setup(409, {
      error: { code: "render_final_already_rendered", message: "This edit has already been rendered." },
      jobId: OTHER_ID,
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("render_final_already_rendered")
    expect(textOf(res)).toContain(OTHER_ID)
  })

  it("settling: tells the client to try again shortly", async () => {
    const { server } = await setup(409, {
      error: { code: "continuation_settling", message: "That run is still being settled. Try again in a moment." },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("continuation_settling")
    expect(textOf(res)).toMatch(/again/i)
  })

  it("an unknown refusal that names a job still reports it", async () => {
    const { server } = await setup(409, { error: { code: "some_new_code", message: "Not now." }, jobId: OTHER_ID })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("some_new_code")
    expect(textOf(res)).toContain(OTHER_ID)
  })

  it("reads the run's type from its own row and continues it on that type's route", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBeFalsy()
    expect(seen.reads).toEqual([`/v1/jobs/${RUN_ID}`])
    expect(seen.url).toBe("/v1/tighten-episode/continue")
  })

  it("continues a Chapters run on the Chapters route", async () => {
    const { server, seen } = await setup(202, { jobId: "job-1" }, {
      status: 200,
      body: { data: { id: RUN_ID, job_type: "episode-chapters", input_data: { type: "episode-chapters", mode: "run" } } },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/episode-chapters/continue")
  })

  it("continues a Trailer run on the Trailer route", async () => {
    const { server, seen } = await setup(202, { jobId: "job-1" }, {
      status: 200,
      body: { data: { id: RUN_ID, job_type: "episode-trailer", input_data: { type: "episode-trailer", mode: "run" } } },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final" })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/episode-trailer/continue")
    expect(seen.body).toMatchObject({ jobId: RUN_ID, mode: "render-final", reviewerPresent: true })
  })

  it("the type the run's input records wins over its job_type", async () => {
    const { server, seen } = await setup(202, { jobId: "job-1" }, {
      status: 200,
      body: { data: { id: RUN_ID, job_type: "apply-edl", input_data: { type: "tighten-episode" } } },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/tighten-episode/continue")
  })

  it("a row with no recorded type is read by its job_type (a run written before the type was recorded)", async () => {
    const { server, seen } = await setup(202, { jobId: "job-1" }, {
      status: 200,
      body: { data: { id: RUN_ID, job_type: "tighten-episode", input_data: { mode: "run" } } },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final" })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/tighten-episode/continue")
  })

  it("refuses a job that is not a use-case run, posting nothing", async () => {
    const { server, seen } = await setup(202, { jobId: "job-1" }, {
      status: 200,
      body: { data: { id: RUN_ID, job_type: "apply-edl", input_data: { edl: {} } } },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(/not a run of a podcast node \(Tighten Episode, Chapters or Trailer\)/)
    expect(seen.url).toBeUndefined()
  })

  it("a job the caller cannot read comes back as the read's refusal, posting nothing", async () => {
    const { server, seen } = await setup(202, { jobId: "job-1" }, {
      status: 404,
      body: { error: { code: "not_found", message: "Job not found" } },
    })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("not_found")
    expect(seen.url).toBeUndefined()
  })

  it("the other continuation refusals come back with their status, code and message", async () => {
    // The route's real status for each code (lib/use-case/continuation.ts, CONTINUATION_REFUSAL_STATUS).
    const refusals: ReadonlyArray<readonly [number, string]> = [
      [404, "not_found"],
      [404, "continuation_not_found"],
      [400, "continuation_subset_required"],
      [409, "continuation_not_failed"],
      [409, "continuation_not_completed"],
      [409, "render_final_not_preview"],
    ]
    for (const [status, code] of refusals) {
      const { server } = await setup(status, { error: { code, message: `refused: ${code}` } })
      const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "from-failed" })
      expect(res.isError, code).toBe(true)
      expect(textOf(res), code).toContain(`(${status} ${code}): refused: ${code}`)
    }
  })
})
