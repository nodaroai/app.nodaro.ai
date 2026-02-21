import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

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

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { downloadRoutes } from "../download.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  await app.register(async (instance) => {
    await downloadRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests — GET /v1/download
// ---------------------------------------------------------------------------

describe("GET /v1/download", () => {
  it("returns 400 when url query param is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/download",
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    expect(body.error.message).toContain("url")
  })

  it("returns 403 for non-R2 domain URL", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/download?url=https://evil.example.com/malicious.png",
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe("forbidden")
    expect(body.error.message).toContain("R2 bucket")
  })

  it("returns file content with attachment header on success", async () => {
    const fileContent = Buffer.from("fake-image-data")
    const mockArrayBuffer = fileContent.buffer.slice(
      fileContent.byteOffset,
      fileContent.byteOffset + fileContent.byteLength,
    )

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      }),
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/download?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/images/test.png",
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("image/png")
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.headers["content-disposition"]).toContain("test.png")

    vi.unstubAllGlobals()
  })

  it("returns 502 when R2 fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
      }),
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/download?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/images/broken.png",
    })

    expect(res.statusCode).toBe(502)
    const body = res.json()
    expect(body.error.code).toBe("proxy_error")
    expect(body.error.message).toContain("500")

    vi.unstubAllGlobals()
  })
})
