/**
 * POST /v1/apply-edl — the 3-hour output cap at the REST ingress (product
 * decision 2026-09-24: "Refuse an EDL whose output exceeds the product's
 * 3-hour cap with a clear 400").
 *
 * What this pins:
 *  - the refusal is a 400 `invalid_edl` whose MESSAGE names the problem — the
 *    SDK and the CLI surface only `code` + `message`, so an issue carried in
 *    `issues[]` alone reached them as a bare "EDL failed validation";
 *  - it happens BEFORE the credit guard, so a caller whose balance could not
 *    cover a 4-hour render hears "over the limit", not "insufficient credits";
 *  - a refused EDL creates no job, reserves nothing and enqueues nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  guardMode: "pass" as "pass" | "insufficient",
  guardCalls: 0,
  insertJob: vi.fn(),
  reserve: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    m.guardCalls++
    if (m.guardMode === "insufficient") {
      return reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
    }
  },
  reserveCreditsForJob: m.reserve,
}))

import { applyEdlRoutes } from "../apply-edl.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const MINUTE = 60_000

function edlOf(outputMs: number) {
  return {
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "https://media.test/episode.mp4", kind: "video" }],
    segments: [{ id: "s0", inMs: 0, outMs: outputMs, video: "A" }],
  }
}

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(applyEdlRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  m.guardMode = "pass"
  m.guardCalls = 0
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 1800, watermark: false })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/apply-edl — the 3-hour output cap", () => {
  it("an edit over 180 minutes → 400 invalid_edl whose message names the length and the cap; nothing created, reserved or enqueued", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/apply-edl", payload: { edl: edlOf(200 * MINUTE) } })

    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: { code: string; message: string; issues: string[] } }
    expect(body.error.code).toBe("invalid_edl")
    expect(body.error.message).toBe(
      "EDL failed validation: the edit renders 200 minutes of output — over the 180-minute limit for one render; " +
        "split it into parts of at most 180 minutes",
    )
    expect(body.error.issues).toHaveLength(1)
    expect(m.guardCalls).toBe(0) // refused ahead of the credit guard
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("a caller whose balance could not cover it still hears the 400, not a 402", async () => {
    m.guardMode = "insufficient"
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/apply-edl", payload: { edl: edlOf(240 * MINUTE) } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe("invalid_edl")
  })

  it("exactly 180 minutes is accepted: guarded, created, reserved once, enqueued", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/apply-edl", payload: { edl: edlOf(180 * MINUTE) } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.guardCalls).toBe(1)
    expect(m.reserve).toHaveBeenCalledTimes(1)
    expect(m.queueAdd).toHaveBeenCalledWith("apply-edl", expect.objectContaining({ jobId: "job-1" }))
  })

  it("every other refused EDL now names its issue in the message too (SDK/CLI parity)", async () => {
    const app = await makeApp()
    const noPicture = { ...edlOf(MINUTE), segments: [{ id: "s0", inMs: 0, outMs: MINUTE }] }
    const res = await app.inject({ method: "POST", url: "/v1/apply-edl", payload: { edl: noPicture, output: "video" } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { message: string } }).error.message).toMatch(
      /^EDL failed validation: .*segment\[0\] "s0" has no video source/,
    )
  })
})
