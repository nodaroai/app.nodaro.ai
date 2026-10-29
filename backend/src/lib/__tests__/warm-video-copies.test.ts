/**
 * warm-video-copies.ts — the CDN's light copies of a video, asked for once so
 * the first viewer does not wait on a cold transform.
 *
 * What must hold:
 *  - the widths mirror the clients' rule: W warmed exactly when the source's
 *    width is unknown (then 480 and 854 only) or W < 1.5 × the source's width;
 *  - the copy address is the clients' own (query kept), and only a plain file
 *    on the platform CDN is warmed (another host, an already transformed
 *    address, a dot segment, not https: nothing);
 *  - fire and forget: a failure, a non-2xx answer or a throwing fetch never
 *    reaches the caller; at most 2 fetches at once; a copy asked for recently
 *    is not asked again, a failed one may be;
 *  - only a finished cast-swap job's video is warmed, with its recorded width.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  FULL_FILE_WIDTH_FACTOR,
  LIGHT_COPY_WIDTHS,
  UNKNOWN_WIDTH_COPIES,
  WARM_CONCURRENCY,
  createVideoCopyWarmer,
  lightCopyUrlsToWarm,
  lightCopyWidths,
  warmCompletedJobVideo,
} from "../warm-video-copies.js"

const FILE = "https://cdn.nodaro.ai/videos/abc.mp4"
const copy = (w: number, path = "videos/abc.mp4") => `https://cdn.nodaro.ai/cdn-cgi/media/width=${w},mode=video/${path}`

const okResponse = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })

describe("lightCopyWidths — mirrors the clients' light-copy rule", () => {
  it("the constants are the clients' widths and factor", () => {
    expect(LIGHT_COPY_WIDTHS).toEqual([480, 854, 1280])
    expect(FULL_FILE_WIDTH_FACTOR).toBe(1.5)
    expect(UNKNOWN_WIDTH_COPIES).toEqual([480, 854])
    expect(WARM_CONCURRENCY).toBe(2)
  })

  it.each([
    [480, [480]], // 854 < 720? no
    [569, [480]], // 854 < 853.5? no
    [570, [480, 854]], // 854 < 855
    [720, [480, 854]], // 1280 < 1080? no
    [853, [480, 854]], // 1280 < 1279.5? no
    [854, [480, 854, 1280]], // 1280 < 1281
    [1080, [480, 854, 1280]],
    [2568, [480, 854, 1280]],
    [320, []], // 480 < 480? no: every copy would play the full file
    [321, [480]],
  ])("a %i px source warms %j", (width, widths) => {
    expect(lightCopyWidths(width)).toEqual(widths)
  })

  it.each([undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])("an unknown width (%s) warms 480 and 854 only", (width) => {
    expect(lightCopyWidths(width as number | null | undefined)).toEqual([480, 854])
  })
})

describe("lightCopyUrlsToWarm — only a plain file on the platform CDN", () => {
  it("builds the clients' copy addresses, query kept", () => {
    expect(lightCopyUrlsToWarm(FILE, 1080)).toEqual([copy(480), copy(854), copy(1280)])
    expect(lightCopyUrlsToWarm("https://cdn.nodaro.ai/trends/t1/display.mp4?v=2", 720)).toEqual([
      copy(480, "trends/t1/display.mp4?v=2"),
      copy(854, "trends/t1/display.mp4?v=2"),
    ])
  })

  it.each([
    "https://assets.nodaro.ai/videos/abc.mp4",
    "https://cdn.nodaro.ai.evil.com/videos/abc.mp4",
    "http://cdn.nodaro.ai/videos/abc.mp4",
    "https://cdn.nodaro.ai/cdn-cgi/media/width=480,mode=video/videos/abc.mp4",
    "https://cdn.nodaro.ai/videos/../secret.mp4",
    "https://cdn.nodaro.ai/./videos/abc.mp4",
    "https://cdn.nodaro.ai//videos/abc.mp4",
    "https://cdn.nodaro.ai/",
    "https://cdn.nodaro.ai/videos/a b.mp4",
    "not a url",
    "",
  ])("%s warms nothing", (url) => {
    expect(lightCopyUrlsToWarm(url, 1080)).toEqual([])
  })
})

describe("createVideoCopyWarmer", () => {
  it("fetches every copy in full and returns at once", async () => {
    const fetch = vi.fn(async () => okResponse())
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch, log: () => undefined })
    expect(warmer.warm(FILE, 720)).toBeUndefined()
    await warmer.idle()
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([copy(480), copy(854)])
    for (const call of fetch.mock.calls) expect((call as unknown[])[1]).toMatchObject({ signal: expect.any(AbortSignal) })
  })

  it("never more than 2 at once", async () => {
    let inFlight = 0
    let peak = 0
    const fetch = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return okResponse()
    })
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch, log: () => undefined })
    warmer.warm("https://cdn.nodaro.ai/videos/a.mp4", 1080)
    warmer.warm("https://cdn.nodaro.ai/videos/b.mp4", 1080)
    await warmer.idle()
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(peak).toBe(2)
  })

  it("a copy asked for recently is not asked again; after the window it is", async () => {
    let t = 1_000
    const fetch = vi.fn(async () => okResponse())
    const warmer = createVideoCopyWarmer({
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => t,
      recentTtlMs: 60_000,
      log: () => undefined,
    })
    warmer.warm(FILE, 720)
    await warmer.idle()
    warmer.warm(FILE, 720)
    warmer.warm(FILE, 1080) // only 1280 is new
    await warmer.idle()
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([copy(480), copy(854), copy(1280)])
    t += 60_000
    warmer.warm(FILE, 720)
    await warmer.idle()
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it("a failure never reaches the caller, is logged at debug, and may be retried", async () => {
    const log = vi.fn()
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce(new Response("no", { status: 502 }))
      .mockResolvedValue(okResponse())
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch, log })
    expect(() => warmer.warm(FILE, 720)).not.toThrow()
    await warmer.idle()
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls.map((c) => c[0]).join("\n")).toMatch(/timed out[\s\S]*502/)
    // Neither failed copy is remembered: asked again, both are fetched.
    warmer.warm(FILE, 720)
    await warmer.idle()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it("a fetch that throws synchronously never reaches the caller", async () => {
    const fetch = vi.fn(() => {
      throw new TypeError("boom")
    })
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch, log: () => undefined })
    expect(() => warmer.warm(FILE)).not.toThrow()
    await warmer.idle()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("a body that fails mid-stream is a logged failure, not a throw", async () => {
    const log = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("reset"))
      },
    })
    const fetch = vi.fn(async () => new Response(body, { status: 200 }))
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch, log, concurrency: 1 })
    warmer.warm(FILE, 400) // 480 only
    await warmer.idle()
    expect(log).toHaveBeenCalledWith(expect.stringContaining("reset"))
  })

  it("beyond the queue's bound, copies are dropped (and not remembered)", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetch = vi.fn(async () => {
      await gate
      return okResponse()
    })
    const log = vi.fn()
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch, concurrency: 1, queueMax: 1, log })
    warmer.warm("https://cdn.nodaro.ai/videos/a.mp4", 400) // in flight
    warmer.warm("https://cdn.nodaro.ai/videos/b.mp4", 400) // queued
    warmer.warm("https://cdn.nodaro.ai/videos/c.mp4", 400) // dropped
    expect(log).toHaveBeenCalledWith(expect.stringContaining("queue full"))
    release()
    await warmer.idle()
    expect(fetch).toHaveBeenCalledTimes(2)
    warmer.warm("https://cdn.nodaro.ai/videos/c.mp4", 400)
    await warmer.idle()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("a non-CDN address fetches nothing", async () => {
    const fetch = vi.fn(async () => okResponse())
    const warmer = createVideoCopyWarmer({ fetch: fetch as unknown as typeof globalThis.fetch })
    warmer.warm("https://example.com/videos/abc.mp4", 1080)
    warmer.warm("https://cdn.nodaro.ai/cdn-cgi/media/width=480,mode=video/videos/abc.mp4")
    await warmer.idle()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("warmCompletedJobVideo — a finished cast-swap job's video", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function settle() {
    // The process warmer's fetches are fire and forget: let them run.
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
  }

  it("warms a cast-swap run's video at its recorded width", async () => {
    const fetch = vi.fn(async () => okResponse())
    vi.stubGlobal("fetch", fetch)
    warmCompletedJobVideo("cast-swap", { videoUrl: "https://cdn.nodaro.ai/videos/run-1.mp4", width: 720, draft: true })
    await settle()
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([copy(480, "videos/run-1.mp4"), copy(854, "videos/run-1.mp4")])
  })

  it("warms a Full Quality version (its own queue name), width unknown: 480 and 854", async () => {
    const fetch = vi.fn(async () => okResponse())
    vi.stubGlobal("fetch", fetch)
    warmCompletedJobVideo("cast-swap-full-quality", { videoUrl: "https://cdn.nodaro.ai/videos/fq-1.mp4" })
    await settle()
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([copy(480, "videos/fq-1.mp4"), copy(854, "videos/fq-1.mp4")])
  })

  it.each([
    ["another job type", "image-to-video", { videoUrl: "https://cdn.nodaro.ai/videos/x1.mp4" }],
    ["the face-mask job", "cast-swap-face-mask", { maskedUrl: "https://cdn.nodaro.ai/videos/x2.mp4" }],
    ["no job type", undefined, { videoUrl: "https://cdn.nodaro.ai/videos/x3.mp4" }],
    ["no video address", "cast-swap", { width: 720 }],
    ["no output", "cast-swap", null],
    ["a video off the CDN", "cast-swap", { videoUrl: "https://elsewhere.example/x4.mp4", width: 1080 }],
  ])("%s warms nothing", async (_label, jobType, output) => {
    const fetch = vi.fn(async () => okResponse())
    vi.stubGlobal("fetch", fetch)
    expect(() => warmCompletedJobVideo(jobType, output as Record<string, unknown> | null)).not.toThrow()
    await settle()
    expect(fetch).not.toHaveBeenCalled()
  })
})
