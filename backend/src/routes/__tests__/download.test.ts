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

// download now fetches via safeFetch (DNS-aware SSRF gate). Stubbing
// globalThis.fetch wouldn't intercept undici's internal fetch, so we mock
// the module directly and configure per-test responses.
vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
  isPrivateOrReservedIP: vi.fn(() => false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { downloadRoutes } from "../download.js"
import { safeFetch } from "../../lib/safe-fetch.js"

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

    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
    } as unknown as Response)

    const res = await app.inject({
      method: "GET",
      url: "/v1/download?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/images/test.png",
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("image/png")
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.headers["content-disposition"]).toContain("test.png")
  })

  it("returns 502 when R2 fetch fails", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
    } as unknown as Response)

    const res = await app.inject({
      method: "GET",
      url: "/v1/download?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/images/broken.png",
    })

    expect(res.statusCode).toBe(502)
    const body = res.json()
    expect(body.error.code).toBe("proxy_error")
    expect(body.error.message).toContain("500")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Prefix-spoofing regression — `rawUrl.startsWith(R2_PUBLIC_URL)` (the
  // previous check) with `R2_PUBLIC_URL=https://assets.nodaro.ai` (no
  // trailing slash, as env.example ships) passed `assets.nodaro.ai.evil.com`
  // and turned /v1/download (public) into a phishing download proxy under
  // app.nodaro.ai. The fix compares parsed origin, not string prefix.
  // ─────────────────────────────────────────────────────────────────────────

  it("rejects a look-alike hostname that shares a string prefix with R2_PUBLIC_URL", async () => {
    const res = await app.inject({
      method: "GET",
      // Prefix matches "https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev"
      // but hostname is attacker-controlled. Must 403.
      url: "/v1/download?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev.evil.com/payload.exe",
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("rejects a URL whose query string embeds the R2 origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/download?url=https://evil.example.com/?x=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/images",
    })

    expect(res.statusCode).toBe(403)
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })
})
