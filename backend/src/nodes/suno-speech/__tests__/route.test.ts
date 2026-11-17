/**
 * POST /v1/suno-speech (the unit's route.ts): validates the body and the
 * limits BEFORE the credit guard (a malformed request hears its 400, never a
 * 402), needs a user, holds the node's flat row at the guard, the reservation
 * and the quote alike, and queues the mode's own fields on the video queue
 * under the node's type. The workflow payload (payload.ts) holds the same row
 * and sends the same run; wired text is the mode's text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  resolved: [] as string[],
  reserveIds: [] as string[],
  insertJob: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: vi.fn() }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundJobHoldsConfirmed: vi.fn() }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn().mockResolvedValue(true) }))
vi.mock("@/middleware/credit-guard.js", async () => ({
  creditGuard: (resolver: (req: FastifyRequest) => string) => async (req: FastifyRequest, _reply: FastifyReply) => {
    m.resolved.push(resolver(req))
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 1, watermark: false }
  },
}))

import { route } from "../route.js"
import { quote } from "../quote.js"
import { payload } from "../payload.js"
import { staticCosts } from "../price.ee.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const URL = "/v1/suno-speech"

async function makeApp(userId: string | null = USER_ID): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = userId ?? undefined
  })
  await app.register(route)
  await app.ready()
  return app
}

beforeEach(() => {
  m.resolved = []
  m.reserveIds = []
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/suno-speech", () => {
  it("a Brief run holds the flat row (guard == reservation == quote) and queues only the brief", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { prompt: "  A short morning news intro  ", script: "dropped" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["suno-speech"])
    expect(m.reserveIds).toEqual(["suno-speech"])
    expect(quote.pricing.modelResolver({ body: {} } as FastifyRequest)).toBe("suno-speech")
    expect(m.queueAdd).toHaveBeenCalledWith("suno-speech", { jobId: "job-1", mode: "brief", prompt: "A short morning news intro", usageLogId: "ul-1" })
  })

  it("a Script run queues the script and the options set", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { mode: "script", script: "Hello.\nWorld.", tone: "warm", variety: 2, vocalGender: "female", backgroundMusic: true } })
    expect(res.statusCode).toBe(200)
    expect(m.queueAdd.mock.calls[0]![1]).toStrictEqual({ jobId: "job-1", mode: "script", script: "Hello.\nWorld.", tone: "warm", variety: 2, vocalGender: "female", backgroundMusic: true, usageLogId: "ul-1" })
  })

  it.each([
    ["an empty brief", { prompt: "   " }],
    ["a brief over 3,000", { prompt: "a".repeat(3001) }],
    ["an empty script", { mode: "script", script: "" }],
    ["a script over 5,000", { mode: "script", script: "a".repeat(5001) }],
    ["a tone over 1,000", { mode: "script", script: "Hi", tone: "t".repeat(1001) }],
    ["variety 5", { mode: "script", script: "Hi", variety: 5 }],
    ["variety 1.5", { mode: "script", script: "Hi", variety: 1.5 }],
    ["an unknown gender", { mode: "script", script: "Hi", vocalGender: "neutral" }],
    ["an unknown mode", { mode: "song", prompt: "x" }],
  ])("%s: 400 before the guard holds anything", async (_name, body) => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: body })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.resolved).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("needs a user", async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: "POST", url: URL, payload: { prompt: "x" } })
    expect(res.statusCode).toBe(401)
  })
})

describe("the price and the workflow payload", () => {
  it("the flat row is 30 credits", () => {
    expect(staticCosts).toStrictEqual({ "suno-speech": 30 })
  })

  const kit = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown> = {}) => {
    const calls: unknown[][] = []
    const result = payload({
      node: { id: "n1", type: "suno-speech", data } as never,
      data,
      resolvedInputs: resolvedInputs as never,
      jobId: "job-9",
      usageLogId: "ul-9",
      ffmpegResult: (...args: unknown[]) => (calls.push(args), { jobName: args[0], payload: args[1], modelIdentifier: args[2] ?? args[0] }) as never,
    })
    return { result, calls }
  }

  it("holds the same row the route holds and sends the same run; wired text is the mode's text", () => {
    const brief = kit({ mode: "brief", prompt: "node brief" }, { prompt: "wired brief" })
    expect(brief.calls[0]).toEqual(["suno-speech", { jobId: "job-9", mode: "brief", prompt: "wired brief", usageLogId: "ul-9" }])
    const script = kit({ mode: "script", script: "node script", tone: "calm" }, { prompt: "wired script" })
    expect(script.calls[0]![1]).toEqual({ jobId: "job-9", mode: "script", script: "wired script", tone: "calm", usageLogId: "ul-9" })
    expect(kit({ mode: "script", script: "own words" }).calls[0]![1]).toMatchObject({ script: "own words" })
  })

  it("a run that cannot be sent fails before anything is reserved", () => {
    expect(() => kit({ mode: "brief", prompt: "" })).toThrow(/needs a brief/)
  })
})
