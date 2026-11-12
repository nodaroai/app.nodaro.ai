/**
 * POST /v1/split-into-layers (the unit's route.ts): validates the body BEFORE
 * the credit guard (a malformed request hears its 400, never a 402), needs a
 * user, holds the row of its settings at the guard and at the reservation —
 * the size's tier at Max layers + 1 — inserts the job and queues it on the
 * video queue under the node's type, with the provider model named for the
 * pickup's safety check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  resolved: [] as string[],
  reserveIds: [] as string[],
  insertJob: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: FastifyRequest) => string) => async (req: FastifyRequest) => {
    m.resolved.push(resolver(req))
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 1, watermark: false }
  },
}))

import { route } from "../route.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const URL = "/v1/split-into-layers"
const IMAGE = "https://media.test/poster.png"

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

describe("POST /v1/split-into-layers", () => {
  it("queues the job with the defaults (9 layers, 1K), holding the default row", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["split-into-layers:1k:10"])
    expect(m.reserveIds).toEqual(["split-into-layers:1k:10"])
    expect(m.queueAdd).toHaveBeenCalledWith("split-into-layers", {
      jobId: "job-1", imageUrl: IMAGE, maxLayers: 9, size: "1K", model: "seedream-5-5-layer-decomposition", usageLogId: "ul-1",
    })
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({ user_id: USER_ID, status: "pending", input_data: expect.objectContaining({ imageUrl: IMAGE, maxLayers: 9, size: "1K" }) })
  })

  it("holds the size's tier at Max layers + 1 and sends a trimmed description", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE, maxLayers: 3, size: "auto", prompt: "  the title and the parrot  " } })
    expect(res.statusCode).toBe(200)
    expect(m.reserveIds).toEqual(["split-into-layers:2k:4"])
    expect(m.queueAdd.mock.calls[0]![1]).toMatchObject({ maxLayers: 3, size: "auto", prompt: "the title and the parrot" })
  })

  it("a direct run keeps the node's own 1-99 range (the app's 1-20 slider is not the route's), at every declared size", async () => {
    for (const size of ["auto", "1K", "1.5K", "2K"]) {
      const app = await makeApp()
      const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE, maxLayers: 99, size } })
      expect(res.statusCode, size).toBe(200)
    }
    expect(m.reserveIds).toContain("split-into-layers:2k:100")
    expect(m.reserveIds).toContain("split-into-layers:1k:100")
  })

  it("an empty description is not sent (the model finds the main elements)", async () => {
    const app = await makeApp()
    await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE, prompt: "   " } })
    expect(m.queueAdd.mock.calls[0]![1]).not.toHaveProperty("prompt")
  })

  it.each([
    ["no image", {}],
    ["Max layers 0", { imageUrl: IMAGE, maxLayers: 0 }],
    ["Max layers 100", { imageUrl: IMAGE, maxLayers: 100 }],
    ["Max layers 2.5", { imageUrl: IMAGE, maxLayers: 2.5 }],
    ["an unknown size", { imageUrl: IMAGE, size: "4K" }],
    ["a description over 2,000 characters", { imageUrl: IMAGE, prompt: "x".repeat(2001) }],
  ])("%s: 400 validation_error before the guard holds anything", async (_name, payload) => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.resolved).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("needs a user", async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE } })
    expect(res.statusCode).toBe(401)
    expect(m.queueAdd).not.toHaveBeenCalled()
  })
})
