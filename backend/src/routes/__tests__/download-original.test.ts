/**
 * `GET /v1/download?original=1` — the app's Download of a video result
 * (decided 2026-11-22): the kept original beside a preview when its job names
 * one (lib/video-download-original.ts), saved as `<id>-original.<ext>` with its
 * own content type, and the address asked for when storage cannot give it;
 * else the file itself, streamed, or — with `open=1` — a redirect to it. No
 * answer to it is cached, and the platform's limiter counts only it. Without
 * `original` the route is unchanged. Every request: the fetch stops when the
 * caller goes away, and a HEAD reads the file's headers only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import rateLimit from "@fastify/rate-limit"

const m = vi.hoisted(() => ({
  target: undefined as string | undefined,
  restricted: new Set<string>(),
}))


vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://cdn.test", R2_PUBLIC_FALLBACK_DOMAIN: "" },
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: vi.fn(), isPrivateOrReservedIP: vi.fn(() => false) }))
vi.mock("@/lib/content-restrictions.js", () => ({ isRestrictedAddress: vi.fn(async (url: string) => m.restricted.has(url)) }))
vi.mock("@/lib/video-download-original.js", () => ({
  videoDownloadTargetOf: vi.fn(async (url: string) => {
    const served = m.target ?? url
    return { url: served, isOriginal: /\/videos\/[^/]+-master\.[a-z0-9]+$/.test(served) }
  }),
}))

import { DOWNLOAD_RATE_LIMIT, downloadFileName, downloadRoutes, ORIGINAL_DOWNLOAD_TIMEOUT_MS } from "../download.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { videoDownloadTargetOf } from "../../lib/video-download-original.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const PREVIEW = `https://cdn.test/videos/${JOB}.mp4`
const ORIGINAL = `https://cdn.test/videos/${JOB}-master.mov`

function upstream(contentType: string, text: string, status = 200): Response {
  const bytes = new TextEncoder().encode(text)
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    headers: new Headers({ "content-type": contentType, "content-length": String(bytes.length) }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  } as unknown as Response
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  m.target = undefined
  m.restricted = new Set()
  app = Fastify({ logger: false })
  await app.register(async (instance) => {
    await downloadRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const ask = (query: string) => app.inject({ method: "GET", url: `/v1/download?url=${encodeURIComponent(PREVIEW)}${query}` })

/** What safeFetch was last asked: the address and its init. */
const lastFetch = () => vi.mocked(safeFetch).mock.calls.at(-1) as [string, { method: string; timeoutMs: number; signal: AbortSignal }]

describe("GET /v1/download?original=1", () => {
  it("streams the kept original as <id>-original.<ext>, with its own content type, the longer limit and no caching", async () => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockResolvedValue(upstream("video/quicktime", "original-bytes"))
    const res = await ask("&original=1")
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("video/quicktime")
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}-original.mov"`)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(res.body).toBe("original-bytes")
    expect(lastFetch()[0]).toBe(ORIGINAL)
    expect(lastFetch()[1]).toMatchObject({ method: "GET", timeoutMs: ORIGINAL_DOWNLOAD_TIMEOUT_MS })
  })

  it("serves the original with open=1 too: only a result without one is redirected", async () => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockResolvedValue(upstream("video/quicktime", "original-bytes"))
    const res = await ask("&original=1&open=1")
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}-original.mov"`)
  })

  it("streams the file itself when there is no original, as before, and does not cache it", async () => {
    vi.mocked(safeFetch).mockResolvedValue(upstream("video/mp4", "preview-bytes"))
    const res = await ask("&original=1")
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("video/mp4")
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}.mp4"`)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(lastFetch()).toEqual([PREVIEW, expect.objectContaining({ method: "GET", timeoutMs: 120_000 })])
  })

  it.each([404, 500, 503])("an original storage answers %i for gives the address asked for instead", async (status) => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockReset()
    vi.mocked(safeFetch).mockResolvedValueOnce(upstream("application/xml", "gone", status)).mockResolvedValueOnce(upstream("video/mp4", "preview-bytes"))
    const res = await ask("&original=1")
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe("preview-bytes")
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}.mp4"`)
    expect(vi.mocked(safeFetch).mock.calls.map((c) => c[0])).toEqual([ORIGINAL, PREVIEW])
    expect(lastFetch()[1]).toMatchObject({ timeoutMs: 120_000 })
  })

  it("an original that cannot be fetched at all gives the address asked for too", async () => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockReset()
    vi.mocked(safeFetch).mockRejectedValueOnce(new Error("connect ECONNRESET")).mockResolvedValueOnce(upstream("video/mp4", "preview-bytes"))
    const res = await ask("&original=1")
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe("preview-bytes")
  })

  it("another answer from the original's storage (a refusal) is the error it always was", async () => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockReset()
    vi.mocked(safeFetch).mockResolvedValueOnce(upstream("application/xml", "denied", 403))
    const res = await ask("&original=1")
    expect(res.statusCode).toBe(502)
    expect(vi.mocked(safeFetch)).toHaveBeenCalledTimes(1)
  })

  it("with open=1 and no original, sends the browser to the file itself, uncached, and fetches nothing", async () => {
    const res = await ask("&original=1&open=1")
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe(PREVIEW)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("an address that IS a kept original (a job that completed on it) is saved, with open=1 too, on the longer limit", async () => {
    for (const query of ["&original=1", "&original=1&open=1"]) {
      vi.mocked(safeFetch).mockResolvedValue(upstream("video/quicktime", "original-bytes"))
      const res = await app.inject({ method: "GET", url: `/v1/download?url=${encodeURIComponent(ORIGINAL)}${query}` })
      expect(res.statusCode).toBe(200)
      expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}-original.mov"`)
      expect(lastFetch()).toEqual([ORIGINAL, expect.objectContaining({ timeoutMs: ORIGINAL_DOWNLOAD_TIMEOUT_MS })])
    }
  })

  it("never redirects off our storage: another host is refused before anything is resolved, uncached", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/download?url=${encodeURIComponent(`https://evil.test/videos/${JOB}.mp4`)}&original=1&open=1` })
    expect(res.statusCode).toBe(403)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(vi.mocked(videoDownloadTargetOf)).not.toHaveBeenCalled()
  })

  it("holds the original to the restrictions, as the address asked for", async () => {
    m.target = ORIGINAL
    m.restricted = new Set([ORIGINAL])
    const res = await ask("&original=1")
    expect(res.statusCode).toBe(451)
    expect(res.json().error.code).toBe("content_restricted")
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("a restricted preview is refused before its original is looked up", async () => {
    m.restricted = new Set([PREVIEW])
    const res = await ask("&original=1&open=1")
    expect(res.statusCode).toBe(451)
    expect(vi.mocked(videoDownloadTargetOf)).not.toHaveBeenCalled()
  })

  it("without original=1 the route serves exactly the file named, with no lookup, cached as before", async () => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockResolvedValue(upstream("video/mp4", "preview-bytes"))
    const res = await ask("")
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}.mp4"`)
    expect(res.headers["cache-control"]).toBe("public, max-age=3600")
    expect(vi.mocked(videoDownloadTargetOf)).not.toHaveBeenCalled()
    // `open` alone changes nothing either.
    vi.mocked(safeFetch).mockResolvedValue(upstream("video/mp4", "preview-bytes"))
    expect((await ask("&open=1")).statusCode).toBe(200)
  })

  it("rejects a mode value other than 1", async () => {
    expect((await ask("&original=yes")).statusCode).toBe(400)
  })
})

describe("GET /v1/download: a caller that goes away, a HEAD, the rate limit", () => {
  it("a HEAD asks storage for the headers only and sends no body", async () => {
    m.target = ORIGINAL
    vi.mocked(safeFetch).mockResolvedValue({ ok: true, status: 200, url: "", headers: new Headers({ "content-type": "video/quicktime", "content-length": "123456" }), body: null } as unknown as Response)
    const res = await app.inject({ method: "HEAD", url: `/v1/download?url=${encodeURIComponent(PREVIEW)}&original=1` })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-length"]).toBe("123456")
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${JOB}-original.mov"`)
    expect(res.body).toBe("")
    expect(lastFetch()).toEqual([ORIGINAL, expect.objectContaining({ method: "HEAD" })])
  })

  it("a HEAD of the plain route is a HEAD upstream too", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ ok: true, status: 200, url: "", headers: new Headers({ "content-type": "video/mp4" }), body: null } as unknown as Response)
    const res = await app.inject({ method: "HEAD", url: `/v1/download?url=${encodeURIComponent(PREVIEW)}` })
    expect(res.statusCode).toBe(200)
    expect(lastFetch()[1]).toMatchObject({ method: "HEAD" })
  })

  it("aborts the fetch and stops reading the file when the caller goes away", async () => {
    let pulls = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    vi.mocked(safeFetch).mockResolvedValue({ ok: true, status: 200, url: "", headers: new Headers({ "content-type": "video/mp4" }), body: endless } as unknown as Response)
    // A server of its own, on a real socket, whose close drops every connection
    // (the dropped download's socket must not hold the test's teardown open).
    const served = Fastify({ logger: false, forceCloseConnections: true })
    await served.register(async (instance) => {
      await downloadRoutes(instance)
    })
    try {
      await served.listen({ port: 0, host: "127.0.0.1" })
      const { port } = served.server.address() as { port: number }
      const controller = new AbortController()
      const response = await fetch(`http://127.0.0.1:${port}/v1/download?url=${encodeURIComponent(PREVIEW)}`, { signal: controller.signal })
      const reader = response.body!.getReader()
      await reader.read()
      controller.abort()
      await reader.cancel().catch(() => undefined)
      await vi.waitFor(() => {
        expect(lastFetch()[1].signal.aborted).toBe(true)
        expect(cancelled).toBe(true)
      }, { timeout: 5000 })
      const pullsAtAbort = pulls
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(pulls - pullsAtAbort).toBeLessThan(5)
    } finally {
      served.server.closeAllConnections()
      await served.close()
    }
  })

  /** An app with the platform's limiter in front of the route, as app.ts registers it (opt-in per route). */
  async function limitedApp(): Promise<FastifyInstance> {
    const limited = Fastify({ logger: false })
    await limited.register(rateLimit, { global: false })
    await limited.register(async (instance) => {
      await downloadRoutes(instance)
    })
    await limited.ready()
    return limited
  }

  it("limits each caller's original=1 downloads with the platform's limiter; the 429 is not cached either", async () => {
    const limited = await limitedApp()
    vi.mocked(safeFetch).mockImplementation(async () => upstream("video/mp4", "x"))
    const answers: Array<{ status: number; cache: unknown }> = []
    for (let i = 0; i <= DOWNLOAD_RATE_LIMIT.max; i++) {
      const res = await limited.inject({ method: "GET", url: `/v1/download?url=${encodeURIComponent(PREVIEW)}&original=1` })
      answers.push({ status: res.statusCode, cache: res.headers["cache-control"] })
    }
    await limited.close()
    expect(answers.slice(0, DOWNLOAD_RATE_LIMIT.max).every((a) => a.status === 200)).toBe(true)
    expect(answers.at(-1)).toEqual({ status: 429, cache: "private, no-store" })
  })

  it("never limits the plain route (images, sound, any file without original=1), as before", async () => {
    const limited = await limitedApp()
    vi.mocked(safeFetch).mockImplementation(async () => upstream("image/png", "x"))
    const statuses: number[] = []
    for (let i = 0; i <= DOWNLOAD_RATE_LIMIT.max + 5; i++) {
      statuses.push((await limited.inject({ method: "GET", url: `/v1/download?url=${encodeURIComponent("https://cdn.test/images/a.png")}` })).statusCode)
    }
    await limited.close()
    expect(statuses.every((s) => s === 200)).toBe(true)
  })
})

describe("downloadFileName", () => {
  it("names a kept original -original, never -master; every other file by its own name", () => {
    expect(downloadFileName(`https://cdn.test/videos/${JOB}-master.webm`, true)).toBe(`${JOB}-original.webm`)
    expect(downloadFileName(`https://cdn.test/videos/${JOB}-merged-master.mp4`, true)).toBe(`${JOB}-merged-original.mp4`)
    expect(downloadFileName(PREVIEW, false)).toBe(`${JOB}.mp4`)
    expect(downloadFileName("https://cdn.test/images/a.png", false)).toBe("a.png")
  })
})
