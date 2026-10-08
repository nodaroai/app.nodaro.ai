/**
 * `rehostByteSize` — how big a media URL is that the relay would re-host,
 * read BEFORE anything is relayed (Speaker View's size refusal, SV12, decided
 * 2026-10-06). It answers only for URLs the re-host would actually read (our
 * own storage on a host nodaro.ai cannot reach); a public URL, or a private
 * host that is not ours, is never re-hosted and so never sized. A size it
 * cannot learn is `undefined` — a preflight refuses only on a real hit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const OWN = "http://localhost:3002/storage/nodaro-assets/"

function setup(opts: { size?: number; sizeThrows?: boolean; key?: boolean } = {}) {
  vi.doMock("../../../lib/config.js", () => ({
    config: { R2_PUBLIC_URL: "http://localhost:3002/storage/nodaro-assets", PUBLIC_URL: "http://localhost:3002", R2_PUBLIC_FALLBACK_DOMAIN: "" },
  }))
  vi.doMock("../../../lib/nodaro-connect.js", () => ({
    getNodaroCredential: async () => null,
    nodaroCloudBase: () => "https://cloud.example",
    nodaroCloudFetch: vi.fn(),
  }))
  const getR2ObjectSize = vi.fn(async () => {
    if (opts.sizeThrows) throw new Error("store down")
    return opts.size ?? 0
  })
  vi.doMock("../../../lib/storage.js", () => ({
    r2KeyFromOurUrl: (url: string) => (opts.key !== false && url.startsWith(OWN) ? url.slice(OWN.length) : null),
    readR2Object: vi.fn(async () => null),
    getR2ObjectSize,
  }))
  return { getR2ObjectSize }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe("rehostByteSize", () => {
  it("reads our own object's size from the store, never fetching its public url", async () => {
    const { getR2ObjectSize } = setup({ size: 3_100_000_000 })
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { rehostByteSize } = await import("../client.js")
    await expect(rehostByteSize(`${OWN}uploads/cam-a.mp4`)).resolves.toBe(3_100_000_000)
    expect(getR2ObjectSize).toHaveBeenCalledWith("uploads/cam-a.mp4")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("falls back to a HEAD of our own url when the store has no size, reading Content-Length", async () => {
    setup({ size: 0 })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-length": "812000000" } }),
    )
    const { rehostByteSize } = await import("../client.js")
    await expect(rehostByteSize(`${OWN}uploads/cam-b.mp4`)).resolves.toBe(812_000_000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("HEAD")
  })

  it("is undefined — not a refusal — when neither the store nor a HEAD can say", async () => {
    setup({ sizeThrows: true })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 405 }))
    const { rehostByteSize } = await import("../client.js")
    await expect(rehostByteSize(`${OWN}uploads/c.mp4`)).resolves.toBeUndefined()

    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"))
    await expect(rehostByteSize(`${OWN}uploads/c.mp4`)).resolves.toBeUndefined()

    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
    await expect(rehostByteSize(`${OWN}uploads/c.mp4`)).resolves.toBeUndefined()
  })

  it("never sizes a url the re-host would not read: a public url, or a private host that is not ours", async () => {
    const { getR2ObjectSize } = setup({ size: 9_000_000_000 })
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { rehostByteSize } = await import("../client.js")
    await expect(rehostByteSize("https://media.example/cam-a.mp4")).resolves.toBeUndefined()
    await expect(rehostByteSize("http://169.254.169.254/latest/meta-data/")).resolves.toBeUndefined()
    await expect(rehostByteSize("http://192.168.1.50/cam.mp4")).resolves.toBeUndefined()
    expect(getR2ObjectSize).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("the in-rehost cap names its size on the error (code media_too_large, bytes), so a caller can name the source", async () => {
    setup()
    vi.doMock("../../../lib/storage.js", () => ({
      r2KeyFromOurUrl: (url: string) => (url.startsWith(OWN) ? url.slice(OWN.length) : null),
      readR2Object: vi.fn(async () => ({ body: Buffer.alloc(0), contentType: "video/mp4", size: 900_000_000 })),
      getR2ObjectSize: vi.fn(async () => 0),
    }))
    const { ensureCloudReachableMediaUrl, MAX_REHOST_BYTES } = await import("../client.js")
    const err = await ensureCloudReachableMediaUrl(`${OWN}uploads/huge.mp4`).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { code?: string }).code).toBe("media_too_large")
    expect((err as { bytes?: number }).bytes).toBe(900_000_000)
    expect((err as Error).message).toMatch(/too large/)
    expect(MAX_REHOST_BYTES).toBe(500_000_000)
  })
})
