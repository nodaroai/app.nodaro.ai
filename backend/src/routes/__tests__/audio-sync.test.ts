/**
 * POST /v1/audio-sync — validation and pricing at the REST ingress.
 *
 * What this pins:
 *  - 2..6 sources, unique ids, a `reference` that names one of them — each
 *    refusal a 400 whose message names the problem, BEFORE the credit guard
 *    (so a caller who could not afford the run still hears what is wrong);
 *  - the guard and the reservation name the SAME row, `audio-sync:<n>src`,
 *    per source count;
 *  - the queued job (and its input_data, which the job-budget registry reads)
 *    carries the sources verbatim, under the job name `audio-sync`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  guardMode: "pass" as "pass" | "insufficient",
  guardIds: [] as string[],
  insertJob: vi.fn(),
  reserve: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: FastifyRequest) => string) =>
    async (req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      m.guardIds.push(resolve(req))
      if (m.guardMode === "insufficient") {
        return reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
      }
    },
  reserveCreditsForJob: m.reserve,
}))

import { audioSyncRoutes } from "../audio-sync.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

const src = (id: string) => ({ id, url: `https://media.test/${id}.m4a` })
const sources = (n: number) => Array.from({ length: n }, (_, i) => src(`s${i + 1}`))

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(audioSyncRoutes)
  await app.ready()
  return app
}

async function post(payload: unknown) {
  const app = await makeApp()
  return app.inject({ method: "POST", url: "/v1/audio-sync", payload: payload as Record<string, unknown> })
}

beforeEach(() => {
  m.guardMode = "pass"
  m.guardIds = []
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 10, watermark: false })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/audio-sync — validation", () => {
  it.each([
    ["one source", { sources: sources(1) }, /sources/],
    ["seven sources", { sources: sources(7) }, /sources/],
    ["no sources", {}, /sources/],
    ["a source with no id", { sources: [{ url: "https://media.test/a.m4a" }, src("b")] }, /sources\.0\.id/],
    ["a source whose url is not a URL", { sources: [{ id: "a", url: "not a url" }, src("b")] }, /sources\.0\.url/],
    ["a private-network url", { sources: [{ id: "a", url: "http://127.0.0.1/a.m4a" }, src("b")] }, /sources\.0\.url/],
  ])("%s → 400 validation_error naming the field; nothing guarded, created, reserved or enqueued", async (_name, body, field) => {
    const res = await post(body)
    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; message: string } }).error
    expect(err.code).toBe("validation_error")
    expect(err.message).toMatch(field)
    expect(m.guardIds).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("duplicate source ids → 400 naming the repeated id", async () => {
    const res = await post({ sources: [src("cam"), src("mic"), src("cam")] })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'sources.2.id: source id "cam" appears more than once — every source needs its own id',
    )
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("a reference that is not one of the sources → 400 naming it", async () => {
    const res = await post({ sources: sources(2), reference: "camX" })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'reference: reference "camX" is not one of the sources\' ids',
    )
    expect(m.guardIds).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("an invalid body is a 400 even for a caller who could not afford the run (validated before the guard)", async () => {
    m.guardMode = "insufficient"
    const res = await post({ sources: sources(1) })
    expect(res.statusCode).toBe(400)
  })
})

describe("POST /v1/audio-sync — pricing and dispatch", () => {
  it.each([
    [2, "audio-sync:2src"],
    [3, "audio-sync:3src"],
    [4, "audio-sync:4src"],
    [5, "audio-sync:5src"],
    [6, "audio-sync:6src"],
  ])("%i sources: the guard and the reservation both name %s", async (n, id) => {
    const res = await post({ sources: sources(n) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.guardIds).toEqual([id])
    expect(m.reserve).toHaveBeenCalledTimes(1)
    expect(m.reserve.mock.calls[0]![3]).toBe(id)
  })

  it("queues `audio-sync` with the sources verbatim + the reference, and stores the same on input_data", async () => {
    const body = { sources: [src("mic"), src("camA"), src("camB")], reference: "camA" }
    const res = await post(body)
    expect(res.statusCode).toBe(200)
    expect(m.queueAdd).toHaveBeenCalledWith("audio-sync", {
      jobId: "job-1",
      sources: body.sources,
      reference: "camA",
      usageLogId: "ul-1",
    })
    const row = m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown>; user_id: string; status: string }
    expect(row.user_id).toBe(USER_ID)
    expect(row.status).toBe("pending")
    expect(row.input_data).toEqual({ sources: body.sources, reference: "camA", type: "audio-sync" })
  })

  it("no reference → none is sent (the worker defaults to the first source)", async () => {
    await post({ sources: sources(2) })
    const [, job] = m.queueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(job).not.toHaveProperty("reference")
  })

  it("a 402 from the guard stops the run before anything is created", async () => {
    m.guardMode = "insufficient"
    const res = await post({ sources: sources(3) })
    expect(res.statusCode).toBe(402)
    expect(m.guardIds).toEqual(["audio-sync:3src"])
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.queueAdd).not.toHaveBeenCalled()
  })
})
