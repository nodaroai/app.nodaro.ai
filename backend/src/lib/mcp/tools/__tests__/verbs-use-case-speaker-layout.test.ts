/**
 * `speaker_layout` (decided 2026-10-17): Speaker Layout's verb posts the
 * recordings and the framing settings to its route — an absent framing source
 * is not sent: the route reads it through Speaker Layout's absent default
 * (auto) for the caller — and refuses what the shared
 * recordings shape refuses before any request. `continue_use_case` continues
 * its runs on its own route: a Render final with no edit, and an edit is the
 * route's `use_case_no_plan` refusal, handed to the agent as it came.
 */
import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor, usecaseTypeOfBuilder } from "@nodaro/render-rules"
import { buildServer, callTool, executeSession, listTools } from "./_helpers.js"
import { registerUseCaseVerbs } from "../verbs-use-case.js"

const TYPE = usecaseTypeOfBuilder("speakerLayout")
const RUN_ID = "00000000-0000-4000-8000-0000000000aa"

/** The route answers `answer` (202 by default); `GET /v1/jobs/:id` answers a Speaker Layout run, as its route writes it. */
async function setup(answer: { status: number; body: unknown } = { status: 202, body: { jobId: "job-1", executionId: "exec-1" } }) {
  const fastify = Fastify()
  const seen: { url?: string; body?: Record<string, unknown> } = {}
  fastify.get("/v1/jobs/:id", async () => ({ data: { id: RUN_ID, job_type: TYPE, input_data: { type: TYPE, mode: "run" } } }))
  for (const url of USE_CASE_NODE_TYPES.flatMap((t) => [usecaseDescriptor(t).route, usecaseContinuePath(t)])) {
    fastify.post(url, async (req, reply) => {
      seen.url = url
      seen.body = req.body as Record<string, unknown>
      return reply.code(answer.status).send(answer.body)
    })
  }
  await fastify.ready()
  const server = buildServer()
  registerUseCaseVerbs({ server, session: executeSession(), fastify })
  return { server, seen }
}

describe("speaker_layout", () => {
  it("is listed, and named by continue_use_case", async () => {
    const { server } = await setup()
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("speaker_layout")
    expect(tools.find((t) => t.name === "continue_use_case")?.description).toMatch(/Speaker Layout run as a NEW job/)
  })

  it("posts the recording to its route; an absent framing source is not sent (the route resolves it)", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "speaker_layout", { media_url: "https://r2/ep.mp4" })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe(usecaseDescriptor(usecaseTypeOfBuilder("speakerLayout")).route)
    expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], mcp_client: "Claude", userId: "u1" })
  })

  it("maps every setting, the recordings and the Cameras settings to the body's names", async () => {
    const { server, seen } = await setup()
    await callTool(server, "speaker_layout", {
      media_urls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      master_audio_url: "https://r2/m.wav",
      cameras: { wide_camera: 2, already_synced: true },
      target_aspect: "1:1",
      layout: "grid",
      switch_type: "cut",
      emphasis: "scale+border",
      framing_source: "static",
      review_before_render: true,
    })
    expect(seen.body).toEqual({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, synced: true },
      targetAspect: "1:1",
      layout: "grid",
      switchType: "cut",
      emphasisStyle: "scale+border",
      framingSource: "static",
      reviewBeforeRender: true,
      reviewerPresent: true,
      mcp_client: "Claude",
      userId: "u1",
    })
  })

  it("refuses an unknown emphasis, and both media_url and media_urls, before any request", async () => {
    const { server, seen } = await setup()
    expect((await callTool(server, "speaker_layout", { media_url: "https://r2/ep.mp4", emphasis: "glow" })).isError).toBe(true)
    expect((await callTool(server, "speaker_layout", { media_url: "https://r2/a.mp4", media_urls: ["https://r2/b.mp4"] })).isError).toBe(true)
    expect(seen.url).toBeUndefined()
  })
})

describe("continue_use_case on a Speaker Layout run", () => {
  it("render-final posts to Speaker Layout's continue route with no edit, the agent as its reviewer", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final" })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe(usecaseContinuePath(TYPE))
    expect(seen.body).toEqual({ jobId: RUN_ID, mode: "render-final", reviewerPresent: true, mcp_client: "Claude", userId: "u1" })
  })

  it("an edited_edl is answered with the route's use_case_no_plan refusal, its code and message intact", async () => {
    const message = "Speaker Layout has no edit to change — run Render final without one."
    const { server, seen } = await setup({ status: 400, body: { error: { code: "use_case_no_plan", message } } })
    const res = await callTool(server, "continue_use_case", { job_id: RUN_ID, mode: "render-final", edited_edl: { v: 1 } })
    expect(res.isError).toBe(true)
    expect(seen.body).toMatchObject({ editedEdl: { v: 1 } })
    const text = JSON.stringify(res.content)
    expect(text).toContain("use_case_no_plan")
    expect(text).toContain("run Render final without one")
  })
})
