import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { referenceBoardRoutes, resolveBoardCreditIdentifier } from "../reference-board.js"

vi.mock("../../lib/idempotent-insert.js", () => ({
  insertWithIdempotencyKey: async () => ({ row: { id: "job1" }, created: true }),
}))
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: async () => ({ usageLogId: "u1" }),
}))
vi.mock("../../lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

describe("POST /v1/reference-board", () => {
  let app: ReturnType<typeof Fastify>
  beforeEach(async () => {
    app = Fastify({ logger: false })
    // Simulate an authenticated session: the real auth middleware sets
    // req.userId (from JWT/API token, or body only when the internal secret is
    // verified). The route MUST read userId from the session, never the body.
    app.addHook("preHandler", async (req: { userId?: string }) => {
      req.userId = "00000000-0000-4000-8000-000000000001"
    })
    await app.register(referenceBoardRoutes)
  })

  it("400s an invalid provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reference-board",
      payload: { provider: "not-a-model", boardTemplate: "character/full-board", prompt: "x" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("accepts a valid board request → 200 with jobId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reference-board",
      payload: {
        provider: "nano-banana-pro",
        boardTemplate: "character/full-board",
        prompt: "make a board",
        resolution: "4K",
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty("jobId")
  })

  it("400s an unknown board template (no prompt) instead of a bare 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reference-board",
      payload: { provider: "nano-banana-pro", boardTemplate: "character/does-not-exist" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("resolveBoardCreditIdentifier builds the provider composite id (pass-through)", () => {
    const id = resolveBoardCreditIdentifier({
      body: { provider: "nano-banana-pro", resolution: "4K" },
    } as never)
    expect(id).toBe("nano-banana-pro:4K")
  })
})
