/**
 * POST /v1/long-image (the unit's route.ts): validates the body BEFORE the
 * credit guard (a malformed request hears its 400, never a 402) — the two
 * modes' fields never mixed, a prompt, a product page's product picture —
 * charges the row of its mode, length, size and the pictures it sends, at the
 * guard and at the reservation, polices the prompt at its assembly point, and
 * queues the job on the video queue under the node's type with the provider
 * model named for the pickup's safety check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  resolved: [] as string[],
  reserveIds: [] as string[],
  insertJob: vi.fn(),
  queueAdd: vi.fn(),
  jobs: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const filters: Array<[string, unknown]> = []
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push([col, v]), q),
        limit: () => q,
        maybeSingle: async () => ({ data: m.jobs.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      }
      return q
    },
  },
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/insert-job.js", () => ({ insertJobIdempotent: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: vi.fn().mockResolvedValue("flipped") }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundJobHoldsConfirmed: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn().mockResolvedValue(true) }))
vi.mock("@/middleware/credit-guard.js", async () => ({
  creditGuard: (
    resolver: (req: FastifyRequest) => string,
    opts?: { beforePricing?: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
  ) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (opts?.beforePricing) {
      await opts.beforePricing(req, reply)
      if (reply.sent) return
    }
    m.resolved.push(resolver(req))
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 1, watermark: false }
  },
}))

import { clearPromptPolicies, registerPromptPolicy } from "@/lib/prompt-policy.js"
import { route } from "../route.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const URL = "/v1/long-image"
const A = "https://media.test/a.png"
const B = "https://media.test/b.png"

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(route)
  await app.ready()
  return app
}

const queued = () => m.queueAdd.mock.calls[0]![1] as Record<string, unknown>

beforeEach(() => {
  m.resolved = []
  m.reserveIds = []
  m.jobs = []
  m.insertJob.mockReset().mockResolvedValue({ row: { id: "job-1" }, created: true })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})
afterEach(() => clearPromptPolicies())

describe("POST /v1/long-image", () => {
  it("a webpage design from a prompt alone, at the defaults: charged the bare webpage row at 2K", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { prompt: " a landing page for a bakery " } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["long-image:webpage:2K"])
    expect(m.reserveIds).toEqual(["long-image:webpage:2K"])
    expect(m.queueAdd).toHaveBeenCalledWith("long-image", {
      jobId: "job-1", mode: "webpage", resolution: "2K", prompt: "a landing page for a bakery", inputImages: 0, model: "kling-4-long-image", usageLogId: "ul-1",
    })
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({ user_id: USER_ID, status: "pending", input_data: expect.objectContaining({ mode: "webpage", inputImages: 0 }) })
  })

  it("a webpage design with a style and a subject picture at 1K is charged for both pictures", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { prompt: "a portfolio like @style", resolution: "1K", styleImageUrl: A, subjectImageUrl: B } })
    expect(res.statusCode).toBe(200)
    expect(m.reserveIds).toEqual(["long-image:webpage:1K:2ref"])
    expect(queued()).toMatchObject({ styleImageUrl: A, subjectImageUrl: B, inputImages: 2 })
  })

  it("a product page keeps the pictures' places, and is charged for each picture once", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { mode: "ecommerce", length: "long", prompt: "a page for @image_3", productImageUrls: [A, null, B] } })
    expect(res.statusCode).toBe(200)
    expect(m.reserveIds).toEqual(["long-image:ecommerce:long:2K:2ref"])
    expect(queued()).toMatchObject({ mode: "ecommerce", length: "long", productImageUrls: [A, null, B], inputImages: 2 })
    const twice = await app.inject({ method: "POST", url: URL, payload: { mode: "ecommerce", prompt: "p", productImageUrls: [A, A] } })
    expect(twice.statusCode).toBe(200)
    expect(m.reserveIds[1]).toBe("long-image:ecommerce:medium:2K:1ref")
  })

  it("refuses, before any price is resolved: an empty prompt, a product page with no product picture, mixed modes, a size it does not make", async () => {
    const app = await makeApp()
    for (const payload of [
      { prompt: "   " },
      { mode: "ecommerce", prompt: "p" },
      { mode: "ecommerce", prompt: "p", productImageUrls: [null] },
      { prompt: "p", productImageUrls: [A] },
      { mode: "ecommerce", prompt: "p", productImageUrls: [A], styleImageUrl: B },
      { prompt: "p", resolution: "4K" },
      { mode: "ecommerce", prompt: "p", productImageUrls: [A, A, A, A] },
      { prompt: "p", styleImageUrl: "not a link" },
    ]) {
      const res = await app.inject({ method: "POST", url: URL, payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(m.resolved).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("the job records, and the worker is sent, the policed prompt", async () => {
    registerPromptPolicy({ id: "test", apply: (a) => ({ ...a, prompt: `${a.prompt} [policed]` }) })
    const app = await makeApp()
    await app.inject({ method: "POST", url: URL, payload: { prompt: "a menu page" } })
    expect(queued().prompt).toBe("a menu page [policed]")
    expect((m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data.prompt).toBe("a menu page [policed]")
  })
})
