import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { referenceBoardRoutes, resolveBoardCreditIdentifier } from "../reference-board.js"

vi.mock("../../lib/idempotent-insert.js", () => ({
  insertWithIdempotencyKey: async () => ({ row: { id: "job1" }, created: true }),
}))
const { queueAdd, reserve } = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  reserve: vi.fn(async () => ({ usageLogId: "u1" })),
}))
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: queueAdd } }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: reserve,
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

  // GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only.
  it.each(["27:16", "16:27", "9:8", "8:9"])("GPT Image 2.5 at %s: a 2K or 4K board is priced as 1K (the CHECK)", (aspectRatio) => {
    for (const provider of ["gpt-image-2-5-flare", "gpt-image-2-5-sunburst"]) {
      for (const resolution of ["2K", "4K"]) {
        expect(resolveBoardCreditIdentifier({ body: { provider, aspectRatio, resolution } } as never)).toBe(provider)
      }
    }
  })

  it("GPT Image 2.5 at another ratio keeps its 2K / 4K price", () => {
    expect(resolveBoardCreditIdentifier({ body: { provider: "gpt-image-2-5-flare", aspectRatio: "16:9", resolution: "2K" } } as never))
      .toBe("gpt-image-2-5-flare:2K")
  })

  it("quote = charge = render: a 4K board at 9:8 reserves the 1K id and is sent at 1K", async () => {
    reserve.mockClear()
    queueAdd.mockClear()
    const payload = { provider: "gpt-image-2-5-sunburst", boardTemplate: "character/full-board", prompt: "x", aspectRatio: "9:8", resolution: "4K" }
    const check = resolveBoardCreditIdentifier({ body: payload } as never)
    const res = await app.inject({ method: "POST", url: "/v1/reference-board", payload })
    expect(res.statusCode).toBe(200)
    const debit = (reserve.mock.calls[0] as unknown[])[3]
    expect(debit).toBe(check)
    expect(debit).toBe("gpt-image-2-5-sunburst")
    expect((queueAdd.mock.calls[0] as unknown[])[1]).toMatchObject({ aspectRatio: "9:8", resolution: "1K" })
  })
})
