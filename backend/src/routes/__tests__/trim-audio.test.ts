/**
 * POST /v1/trim-audio (routes/trim-audio.ts) given a social link is an import
 * of a link: the gate reads at the route, so a refusal is 403 with no job row
 * behind it, and the confirmation rides in the job data for the worker to
 * spend at the fetch. A direct file never asks the gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  insertJob: vi.fn(),
  queueAdd: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  requireImportAllowed: vi.fn(),
}))

vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
}))

import { trimAudioRoutes } from "../trim-audio.js"
import { OWN_MEDIA_URL, withLinkImportsOff } from "@/test/link-imports-off.js"

class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const USER = "00000000-0000-4000-8000-000000000001"
const SOCIAL = "https://www.youtube.com/watch?v=abc"
const DIRECT = "https://cdn.example.com/clip.mp4"
const ID = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(trimAudioRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/trim-audio", headers: { "x-user-id": USER }, payload })

describe("POST /v1/trim-audio", () => {
  it("a refusal by the gate is 403 and creates no job", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("import_source_disabled", "This link can't be imported here."))
    const res = await post({ videoUrl: SOCIAL, confirmationId: ID })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "import_source_disabled", message: "This link can't be imported here." })
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: USER, confirmationId: ID, lane: "route" }))
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the confirmation is checked at the route and rides in the job data for the worker to spend", async () => {
    const res = await post({ videoUrl: SOCIAL, confirmationId: ID, startTime: 1 })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd).toHaveBeenCalledWith("trim-audio", expect.objectContaining({ jobId: "job-1", videoUrl: SOCIAL, confirmationId: ID, startTime: 1, usageLogId: "usage-1" }))
  })

  it("a direct file never asks the gate", async () => {
    const res = await post({ videoUrl: DIRECT })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.queueAdd).toHaveBeenCalledWith("trim-audio", expect.objectContaining({ videoUrl: DIRECT }))
  })
})

describe("POST /v1/trim-audio on a deployment that turned link imports off", () => {
  withLinkImportsOff()

  it("refuses a direct file on another site before any job, and never asks the gate", async () => {
    const res = await post({ videoUrl: DIRECT })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
  })

  it("refuses a social link the same way", async () => {
    const res = await post({ videoUrl: SOCIAL })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("a file of this deployment's own storage still runs", async () => {
    const res = await post({ videoUrl: OWN_MEDIA_URL })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd).toHaveBeenCalledWith("trim-audio", expect.objectContaining({ videoUrl: OWN_MEDIA_URL }))
  })
})
