import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    R2_PUBLIC_URL: "https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// image-proxy now fetches via safeFetch (DNS-aware SSRF gate). Stubbing
// globalThis.fetch wouldn't intercept undici's internal fetch, so we mock
// the module directly and configure per-test responses via vi.mocked().
vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
  isPrivateOrReservedIP: vi.fn(() => false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { imageProxyRoutes } from "../image-proxy.js"
import { safeFetch } from "../../lib/safe-fetch.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  await app.register(async (instance) => {
    await imageProxyRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests — GET /v1/image-proxy
// ---------------------------------------------------------------------------

describe("GET /v1/image-proxy", () => {
  it("returns 400 when url query param is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/image-proxy" })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 403 when download=1 with a non-R2 URL (closes open-download-proxy gap)", async () => {
    // CRITICAL: without this gate, ?url=<arbitrary>&download=1 turns the route
    // into a phishing/malware delivery vector under app.nodaro.ai.
    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://evil.example.com/payload.exe&download=1",
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe("forbidden")
    expect(body.error.message).toContain("Nodaro media")
  })

  it("rejects download=1 for a hostname that shares a string prefix with R2_PUBLIC_URL", async () => {
    // Regression: previously `rawUrl.startsWith(config.R2_PUBLIC_URL)` passed
    // `https://<R2_PUBLIC_URL>.evil.com/…` because prefix-matching doesn't
    // distinguish the hostname boundary. Fix compares parsed origin.
    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev.evil.com/payload.exe&download=1",
    })

    expect(res.statusCode).toBe(403)
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("does not reach upstream fetch when download mode is rejected", async () => {
    await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://evil.example.com/payload.exe&download=1",
    })

    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("allows download=1 for the R2 public URL host", async () => {
    const fileContent = Buffer.from("png-bytes")
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(fileContent)
        controller.close()
      },
    })

    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/octet-stream" }),
      body: stream,
    } as unknown as Response)

    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/images/test.png&download=1",
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.headers["content-disposition"]).toContain("test.png")
  })

  it("allows download=1 for the configured R2_PUBLIC_URL", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("x"))
        controller.close()
      },
    })

    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "video/mp4" }),
      body: stream,
    } as unknown as Response)

    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://pub-c813076fe3024da78029786e7b9fd59d.r2.dev/videos/clip.mp4&download=1",
    })

    expect(res.statusCode).toBe(200)
  })

  it("still proxies non-download images from arbitrary domains (cached-image use case)", async () => {
    // The non-download path stays permissive: safeUrlSchema blocks syntactic
    // red flags, safeFetch blocks DNS-resolved private IPs at connect time,
    // and the content-type check rejects non-images. Any public image URL
    // (avatar, OG preview, etc.) must still pass through for display.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("img"))
        controller.close()
      },
    })

    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: stream,
    } as unknown as Response)

    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://example.com/avatar.jpg",
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("image/jpeg")
    // Non-download mode must NOT force an attachment header
    expect(res.headers["content-disposition"]).toBeUndefined()
  })

  it("rejects non-image content-type when not in download mode", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
    } as unknown as Response)

    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://example.com/doc.pdf",
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when safeFetch blocks the resolved upstream address", async () => {
    vi.mocked(safeFetch).mockRejectedValue(
      new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.7"),
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://example.com/avatar.jpg",
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 502 instead of leaking an uncaught 500 when upstream fetch throws", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("connect ENETUNREACH"))

    const res = await app.inject({
      method: "GET",
      url: "/v1/image-proxy?url=https://example.com/avatar.jpg",
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("proxy_error")
  })
})
