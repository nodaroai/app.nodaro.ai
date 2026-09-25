import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// app-reports lane G (2026-09-04): two seedance-2-5 i2v jobs died in
// `ensureImageForProvider` with `Failed to download image: HTTP 404` on a
// `cdn.nodaro.ai` object we had written ourselves, four minutes apart, both
// with credits already reserved. A 404 from OUR host for an object we minted
// is a contradiction, not an answer — these tests pin the bounded retry that
// now sits in front of it, and pin just as hard that nothing else retries.

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  sleep: vi.fn(async (_ms: number) => {}),
}))

vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../sleep.js", () => ({ sleep: mocks.sleep }))

const { fetchOwnMedia, isOwnMediaUrl, cacheBustedUrl, OWN_MEDIA_RETRY_DELAYS_MS } = await import(
  "../fetch-own-media.js"
)

const OWN = "https://cdn.nodaro.test/images/abc.png"
const FOREIGN = "https://tempfile.example/user-upload.png"

/** Minimal stand-in for the undici Response the helper inspects. */
const reply = (status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  body: { cancel: async () => {} },
})

describe("fetch-own-media", () => {
  const prevPublic = process.env.R2_PUBLIC_URL
  const prevFallback = process.env.R2_PUBLIC_FALLBACK_DOMAIN

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    delete process.env.R2_PUBLIC_FALLBACK_DOMAIN
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    if (prevPublic === undefined) delete process.env.R2_PUBLIC_URL
    else process.env.R2_PUBLIC_URL = prevPublic
    if (prevFallback === undefined) delete process.env.R2_PUBLIC_FALLBACK_DOMAIN
    else process.env.R2_PUBLIC_FALLBACK_DOMAIN = prevFallback
    vi.restoreAllMocks()
  })

  describe("isOwnMediaUrl", () => {
    it("matches the configured CDN origin and the fallback host, nothing else", () => {
      expect(isOwnMediaUrl(OWN)).toBe(true)
      expect(isOwnMediaUrl(FOREIGN)).toBe(false)
      // Exact origin, not a suffix — the spoof the cdn-host helper defeats.
      expect(isOwnMediaUrl("https://cdn.nodaro.test.evil.example/x.png")).toBe(false)
      process.env.R2_PUBLIC_FALLBACK_DOMAIN = "media.nodaro.test"
      expect(isOwnMediaUrl("https://media.nodaro.test/images/a.png")).toBe(true)
    })

    it("does not throw on an unparsable URL", () => {
      expect(isOwnMediaUrl("not a url")).toBe(false)
    })
  })

  describe("the retry", () => {
    it("404 then 200 on our own host: succeeds, two fetches, one pause", async () => {
      mocks.safeFetch.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(reply(200))
      const res = await fetchOwnMedia(OWN, { timeoutMs: 30_000 })
      expect(res.status).toBe(200)
      expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
      expect(mocks.sleep).toHaveBeenCalledTimes(1)
      expect(mocks.sleep).toHaveBeenCalledWith(OWN_MEDIA_RETRY_DELAYS_MS[0])
      // The init is carried into the retry unchanged.
      expect(mocks.safeFetch.mock.calls[1][1]).toEqual({ timeoutMs: 30_000 })
    })

    it("5xx then 200 on our own host: retried too", async () => {
      mocks.safeFetch.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200))
      await expect(fetchOwnMedia(OWN)).resolves.toMatchObject({ status: 200 })
      expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
    })

    it("exhausts the ladder and returns the LAST response unchanged", async () => {
      mocks.safeFetch.mockResolvedValue(reply(404))
      const res = await fetchOwnMedia(OWN)
      expect(res.status).toBe(404)
      expect(res.ok).toBe(false)
      expect(mocks.safeFetch).toHaveBeenCalledTimes(OWN_MEDIA_RETRY_DELAYS_MS.length + 1)
      expect(mocks.sleep.mock.calls.map((c) => c[0])).toEqual([...OWN_MEDIA_RETRY_DELAYS_MS])
    })

    it("a foreign host's 404 is an ANSWER — one fetch, no pause", async () => {
      mocks.safeFetch.mockResolvedValue(reply(404))
      await expect(fetchOwnMedia(FOREIGN)).resolves.toMatchObject({ status: 404 })
      expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
      expect(mocks.sleep).not.toHaveBeenCalled()
    })

    it("a decision from our own host (401/403/410/413) is never retried", async () => {
      for (const status of [401, 403, 410, 413]) {
        vi.clearAllMocks()
        mocks.safeFetch.mockResolvedValue(reply(status))
        await expect(fetchOwnMedia(OWN)).resolves.toMatchObject({ status })
        expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
      }
    })

    it("a first-try 200 costs exactly one fetch and no pause", async () => {
      mocks.safeFetch.mockResolvedValue(reply(200))
      await expect(fetchOwnMedia(OWN)).resolves.toMatchObject({ status: 200 })
      expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
      expect(mocks.sleep).not.toHaveBeenCalled()
    })

    it("stops as soon as the status stops being transient", async () => {
      mocks.safeFetch.mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(403))
      await expect(fetchOwnMedia(OWN)).resolves.toMatchObject({ status: 403 })
      expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
    })

    it("a transport throw propagates — the connection ladder is not this helper's job", async () => {
      mocks.safeFetch.mockRejectedValue(new Error("safeFetch: blocked — private IP"))
      await expect(fetchOwnMedia(OWN)).rejects.toThrow("private IP")
      expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
    })

    it("first attempt uses the plain URL; every retry a distinct cache-busted one", async () => {
      // The media paths edge-cache a 404 for a year: re-asking the SAME URL
      // re-reads the cached 404, so only a URL the edge has never seen can
      // reach the origin.
      mocks.safeFetch.mockResolvedValue(reply(404))
      await fetchOwnMedia(OWN)
      const urls = mocks.safeFetch.mock.calls.map((c) => String(c[0]))
      expect(urls[0]).toBe(OWN)
      const retries = urls.slice(1)
      expect(retries).toHaveLength(OWN_MEDIA_RETRY_DELAYS_MS.length)
      for (const u of retries) {
        expect(u.startsWith(`${OWN}?cb=`)).toBe(true)
      }
      expect(new Set(retries).size).toBe(retries.length)
    })

    it("a first-try 200 never touches the URL", async () => {
      mocks.safeFetch.mockResolvedValue(reply(200))
      await fetchOwnMedia(`${OWN}?v=2`)
      expect(mocks.safeFetch).toHaveBeenCalledWith(`${OWN}?v=2`, {})
    })

    it("never logs the object path (keys can carry signed query values)", async () => {
      const warn = vi.mocked(console.warn)
      mocks.safeFetch.mockResolvedValue(reply(404))
      await fetchOwnMedia(`${OWN}?signature=deadbeef`)
      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n")
      expect(logged).toContain("cdn.nodaro.test")
      expect(logged).not.toContain("signature")
      expect(logged).not.toContain("/images/")
    })
  })

  describe("cacheBustedUrl", () => {
    it("adds a query when the URL has none", () => {
      expect(cacheBustedUrl(OWN, 2)).toMatch(/^https:\/\/cdn\.nodaro\.test\/images\/abc\.png\?cb=2-[a-z0-9]+$/)
    })

    it("preserves an existing query byte-for-byte and appends after it", () => {
      const withQuery = `${OWN}?v=a%20b&x=1+2`
      const busted = cacheBustedUrl(withQuery, 3)
      expect(busted.startsWith(`${withQuery}&cb=3-`)).toBe(true)
    })

    it("keeps a fragment after the query", () => {
      const busted = cacheBustedUrl(`${OWN}?v=1#t=5`, 2)
      expect(busted).toMatch(/\?v=1&cb=2-[a-z0-9]+#t=5$/)
    })

    it("is different on every call", () => {
      expect(cacheBustedUrl(OWN, 2)).not.toBe(cacheBustedUrl(OWN, 2))
    })

    it("leaves a pre-signed URL and an unparsable URL untouched", () => {
      const signed = `${OWN}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`
      expect(cacheBustedUrl(signed, 2)).toBe(signed)
      expect(cacheBustedUrl("not a url", 2)).toBe("not a url")
    })
  })
})
