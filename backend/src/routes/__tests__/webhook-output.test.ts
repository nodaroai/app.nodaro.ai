import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
}))

import { webhookOutputRoutes } from "../webhook-output.js"
import { supabase } from "../../lib/supabase.js"
import { safeFetch } from "../../lib/safe-fetch.js"

let app: FastifyInstance

function setupJobMocks() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
  })
  await app.register(async (instance) => {
    await webhookOutputRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/webhook-output/send", () => {
  it("returns 400 when safeFetch blocks the webhook URL", async () => {
    setupJobMocks()
    vi.mocked(safeFetch).mockRejectedValue(
      new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.9"),
    )

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: {
        url: "https://example.com/hook",
        payload: { hello: "world" },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      jobId: "job-1",
      success: false,
      statusCode: 0,
      responseBody: "",
      error: "Webhook URL resolves to a blocked address",
    })
  })
})
