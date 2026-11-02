/**
 * POST /v1/extract-youtube-audio (routes/extract-youtube-audio.ts) is an
 * import of a link: the gate reads at the route, so a refusal is 403 with no
 * job row behind it, and the confirmation rides in the job data for the
 * worker to spend at the fetch.
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
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
}))

import { extractYouTubeAudioRoutes } from "../extract-youtube-audio.js"

class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const USER = "00000000-0000-4000-8000-000000000001"
const URL_ = "https://www.youtube.com/watch?v=abc"
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
  await app.register(extractYouTubeAudioRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>, user: string | null = USER) =>
  app.inject({ method: "POST", url: "/v1/extract-youtube-audio", headers: user ? { "x-user-id": user } : {}, payload })

describe("POST /v1/extract-youtube-audio", () => {
  it("a refusal by the gate is 403 and creates no job", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("rights_confirmation_required", "Confirm first"))
    const res = await post({ youtubeUrl: URL_ })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "rights_confirmation_required", message: "Confirm first" })
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(URL_, expect.objectContaining({ userId: USER, confirmationId: undefined, lane: "route" }))
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the confirmation is checked at the route and rides in the job data for the worker to spend", async () => {
    const res = await post({ youtubeUrl: URL_, confirmationId: ID })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(URL_, expect.objectContaining({ userId: USER, confirmationId: ID }))
    expect(mocks.queueAdd).toHaveBeenCalledWith("extract-youtube-audio", { jobId: "job-1", youtubeUrl: URL_, confirmationId: ID })

    await post({ youtubeUrl: URL_ })
    expect(mocks.queueAdd).toHaveBeenLastCalledWith("extract-youtube-audio", { jobId: "job-1", youtubeUrl: URL_ })
  })

  it("needs a signed-in account; nothing is asked of the gate without one", async () => {
    expect((await post({ youtubeUrl: URL_ }, null)).statusCode).toBe(401)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
  })
})
