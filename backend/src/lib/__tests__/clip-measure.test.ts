/**
 * The ONE measurement of a clip (Speaker View's Video input, D16): the real end
 * of its picture track, from its own packets after a download behind the SSRF
 * guard — never the container's declared duration — and its pixels. Cached per
 * address and shared between concurrent callers, so the editor's run and the
 * server's run make the same number once.
 */
import { describe, it, expect, vi } from "vitest"
import { ClipMeasureError, clipCacheKey, measureClip, parseFrameSize, type ClipMeasureDeps } from "../clip-measure.js"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"

function deps(over: Partial<ClipMeasureDeps> = {}): ClipMeasureDeps & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    download: vi.fn(async () => {}),
    streamEnds: vi.fn(async () => ({ video: { state: "measured" as const, endSec: 14.6 }, audio: { state: "measured" as const, endSec: 14.7 } })),
    frameSize: vi.fn(async () => ({ width: 640, height: 360 })),
    cacheGet: vi.fn(async (k: string) => store.get(k) ?? null),
    cacheSet: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    ...over,
  }
}

describe("measureClip", () => {
  it("returns the picture track's measured end in whole milliseconds, and the pixels", async () => {
    const d = deps()
    await expect(measureClip(URL, d)).resolves.toEqual({ durationMs: 14_600, width: 640, height: 360 })
  })

  it("floors to a whole millisecond (a length past the last frame is billed per minute)", async () => {
    const d = deps({ streamEnds: vi.fn(async () => ({ video: { state: "measured" as const, endSec: 1.23459 }, audio: { state: "absent" as const } })) })
    expect((await measureClip(URL, d)).durationMs).toBe(1234)
  })

  it("reads the picture track, not the sound's (a podcast's audio can outlast its picture)", async () => {
    const d = deps({ streamEnds: vi.fn(async () => ({ video: { state: "measured" as const, endSec: 10 }, audio: { state: "measured" as const, endSec: 99 } })) })
    expect((await measureClip(URL, d)).durationMs).toBe(10_000)
  })

  it("never falls back to a declared duration: an unmeasured picture track is refused in plain words", async () => {
    const d = deps({ streamEnds: vi.fn(async () => ({ video: { state: "unmeasured" as const, reason: "x", declaredEndSec: 20 }, audio: { state: "absent" as const } })) })
    await expect(measureClip(URL, d)).rejects.toMatchObject({ code: "unmeasured" })
  })

  it("refuses a file with no picture", async () => {
    const d = deps({ streamEnds: vi.fn(async () => ({ video: { state: "absent" as const }, audio: { state: "measured" as const, endSec: 5 } })) })
    await expect(measureClip(URL, d)).rejects.toMatchObject({ code: "no-picture" })
  })

  it("refuses an address the guard rejects without downloading anything", async () => {
    const d = deps()
    for (const bad of ["http://127.0.0.1/a.mp4", "http://169.254.169.254/x", "file:///etc/passwd", "not a url"]) {
      await expect(measureClip(bad, d)).rejects.toMatchObject({ code: "invalid-url" })
    }
    expect(d.download).not.toHaveBeenCalled()
  })

  it("says a download that failed is unreadable, without leaking the vendor error", async () => {
    const d = deps({ download: vi.fn(async () => { throw new Error("ECONNRESET secret-host") }) })
    const err = await measureClip(URL, d).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClipMeasureError)
    expect((err as ClipMeasureError).code).toBe("unreadable")
    expect((err as ClipMeasureError).message).not.toMatch(/secret-host/)
  })

  it("keeps the length when the pixels cannot be read", async () => {
    const d = deps({ frameSize: vi.fn(async () => { throw new Error("no size") }) })
    await expect(measureClip(URL, d)).resolves.toEqual({ durationMs: 14_600 })
  })

  it("measures an address once: the second ask is a cache hit", async () => {
    const d = deps()
    const first = await measureClip(URL, d)
    const second = await measureClip(URL, d)
    expect(second).toEqual(first)
    expect(d.download).toHaveBeenCalledTimes(1)
  })

  it("shares one measurement between concurrent callers", async () => {
    const d = deps()
    const [a, b] = await Promise.all([measureClip(URL, d), measureClip(URL, d)])
    expect(a).toEqual(b)
    expect(d.download).toHaveBeenCalledTimes(1)
  })

  it("does not cache a failure", async () => {
    const d = deps({ download: vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue(undefined) })
    await expect(measureClip(URL, d)).rejects.toMatchObject({ code: "unreadable" })
    await expect(measureClip(URL, d)).resolves.toMatchObject({ durationMs: 14_600 })
  })

  it("survives a cache that is down", async () => {
    const d = deps({ cacheGet: vi.fn(async () => { throw new Error("redis down") }), cacheSet: vi.fn(async () => { throw new Error("redis down") }) })
    await expect(measureClip(URL, d)).resolves.toMatchObject({ durationMs: 14_600 })
  })

  it("ignores a malformed cache entry", async () => {
    const d = deps()
    d.store.set(clipCacheKey(URL), "{")
    await expect(measureClip(URL, d)).resolves.toMatchObject({ durationMs: 14_600 })
  })
})

describe("measureClip: faces (decided 2026-10-12, R2)", () => {
  it("records whether the sampled frames show a face, from the downloaded file and its measured size", async () => {
    const facePresence = vi.fn(async () => "none" as const)
    const d = deps({ facePresence })
    await expect(measureClip(URL, d)).resolves.toEqual({ durationMs: 14_600, width: 640, height: 360, faces: "none" })
    expect(facePresence).toHaveBeenCalledWith(expect.stringMatching(/clip\.mp4$/), { durationMs: 14_600, width: 640, height: 360 })
  })

  it("keeps the whole measurement when the face look fails: faces are unknown, nothing is refused", async () => {
    const d = deps({ facePresence: vi.fn(async () => { throw new Error("no detector") }) })
    await expect(measureClip(URL, d)).resolves.toEqual({ durationMs: 14_600, width: 640, height: 360, faces: "unknown" })
  })

  it("writes no faces field when the host has no face look at all", async () => {
    await expect(measureClip(URL, deps())).resolves.not.toHaveProperty("faces")
  })

  it("caches the answer with its faces, so the second run is instant and the same", async () => {
    const facePresence = vi.fn(async () => "present" as const)
    const d = deps({ facePresence })
    const first = await measureClip(URL, d)
    const second = await measureClip(URL, d)
    expect(second).toEqual(first)
    expect(second.faces).toBe("present")
    expect(facePresence).toHaveBeenCalledTimes(1)
  })

  it("never trusts an entry from before faces were measured (the v1 key is not read)", async () => {
    expect(clipCacheKey(URL)).toMatch(/^clip-measure:v2:/)
    const d = deps({ facePresence: vi.fn(async () => "present" as const) })
    d.store.set(clipCacheKey(URL).replace(":v2:", ":v1:"), JSON.stringify({ durationMs: 1, width: 1, height: 1 }))
    await expect(measureClip(URL, d)).resolves.toMatchObject({ durationMs: 14_600, faces: "present" })
  })

  it("drops a cached faces value it does not know", async () => {
    const d = deps()
    d.store.set(clipCacheKey(URL), JSON.stringify({ durationMs: 5000, faces: "maybe" }))
    await expect(measureClip(URL, d)).resolves.toMatchObject({ durationMs: 14_600 })
  })
})

describe("measureClip: the byte cap", () => {
  it("hands the download the cap it was given", async () => {
    const d = deps()
    await measureClip(URL, d, { maxBytes: 500 * 1024 * 1024 })
    expect(d.download).toHaveBeenCalledWith(URL, expect.any(String), { maxBytes: 500 * 1024 * 1024 })
  })

  it("says a file over the cap is too big, in plain words, and does not cache it", async () => {
    const tooBig = new Error("Download exceeds 500 MB: https://cdn.example.test/uploads/videos/clip.mp4")
    const d = deps({ download: vi.fn().mockRejectedValueOnce(tooBig).mockResolvedValue(undefined) })
    const err = await measureClip(URL, d, { maxBytes: 500 * 1024 * 1024 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClipMeasureError)
    expect((err as ClipMeasureError).code).toBe("too-large")
    expect((err as ClipMeasureError).message).toMatch(/500 MB/)
    await expect(measureClip(URL, d, { maxBytes: 500 * 1024 * 1024 })).resolves.toMatchObject({ durationMs: 14_600 })
  })
})

describe("measureClip: concurrent callers with different caps", () => {
  it("F7: a capped caller never inherits an in-flight UNCAPPED measurement of the same address", async () => {
    // Answered by the caller's cap, not by call order: each caller awaits a real
    // temp-dir creation before it downloads, so which one downloads first is
    // not fixed (CI ran the capped one first and it waited on the uncapped stall).
    // The stall is one gate made up front, so releasing it does not depend on
    // the uncapped download having STARTED: under load the capped call could
    // finish first, the release then hit nothing, and the uncapped download
    // waited on a resolver no one held until the 5 s timeout (dev 2929ac537).
    let releaseFirst: () => void = () => {}
    const stall = new Promise<void>((resolve) => { releaseFirst = resolve })
    const download = vi.fn((_url: string, _dest: string, opts?: { maxBytes?: number }) =>
      opts?.maxBytes === undefined ? stall : Promise.reject(new Error("Download exceeds 500 MB: x")),
    )
    const d = deps({ download })
    const uncapped = measureClip(URL, d)
    const capped = measureClip(URL, d, { maxBytes: 500 * 1024 * 1024 })
    await expect(capped).rejects.toMatchObject({ code: "too-large" })
    releaseFirst()
    await expect(uncapped).resolves.toMatchObject({ durationMs: 14_600 })
    expect(download).toHaveBeenCalledTimes(2)
  })

  it("callers with the same cap still share one measurement", async () => {
    const d = deps()
    await Promise.all([measureClip(URL, d, { maxBytes: 1024 }), measureClip(URL, d, { maxBytes: 1024 })])
    expect(d.download).toHaveBeenCalledTimes(1)
  })
})

describe("parseFrameSize", () => {
  it("reads width and height", () => {
    expect(parseFrameSize(JSON.stringify({ streams: [{ width: 640, height: 360 }] }))).toEqual({ width: 640, height: 360 })
  })
  it("swaps a quarter-turn rotation (the picture is shown turned)", () => {
    expect(parseFrameSize(JSON.stringify({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] }))).toEqual({ width: 1080, height: 1920 })
    expect(parseFrameSize(JSON.stringify({ streams: [{ width: 1920, height: 1080, tags: { rotate: "270" } }] }))).toEqual({ width: 1080, height: 1920 })
  })
  it("keeps a half-turn", () => {
    expect(parseFrameSize(JSON.stringify({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: 180 }] }] }))).toEqual({ width: 1920, height: 1080 })
  })
  it("throws on a listing with no picture size", () => {
    expect(() => parseFrameSize("{}")).toThrow()
    expect(() => parseFrameSize("nope")).toThrow()
  })
})
