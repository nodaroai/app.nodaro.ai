import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks must replace the bindings BEFORE the module under test imports them.
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn().mockResolvedValue("/tmp/media-proxy-work"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  BIG_MEDIA_DOWNLOAD_LIMITS: { responseMs: 1, windowMs: 1, minBytesPerWindow: 1, maxBytes: 1, floorBytesPerSec: 1, maxMs: 1 },
  downloadFile: vi.fn().mockResolvedValue(undefined),
  hasAudioStream: vi.fn().mockResolvedValue(true),
  runFfmpeg: vi.fn().mockResolvedValue(""),
}))
vi.mock("../video-proxy-encode.js", () => ({
  encodeVideoProxy: vi.fn(),
}))
vi.mock("../../lib/storage.js", () => ({
  getR2ObjectSize: vi.fn().mockResolvedValue(0),
  readR2ObjectBuffer: vi.fn().mockResolvedValue(null),
  uploadBufferToR2: vi.fn((_b: Buffer, key: string) => Promise.resolve(`https://cdn.test/${key}`)),
  r2KeyFromOurUrl: vi.fn().mockReturnValue(null), // treat every source as an external URL
  r2Url: vi.fn((key: string) => `https://cdn.test/${key}`),
  uploadLocalFileToR2Key: vi.fn((_f: string, key: string) => Promise.resolve(`https://cdn.test/${key}`)),
}))

import { createWorkDir, cleanupWorkDir, downloadFile, hasAudioStream, runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import { getR2ObjectSize, readR2ObjectBuffer, uploadBufferToR2, uploadLocalFileToR2Key } from "../../lib/storage.js"
import { encodeVideoProxy } from "../video-proxy-encode.js"
import { ensureMediaProxy, MediaHasNoAudioError, mediaProxyKey, mediaProxyManifestKey } from "../media-proxy.js"
import { InvalidProxySpansError } from "../media-proxy-span-map.js"
import { SCENE_CUT_RECIPE } from "../media-proxy-cuts.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

const SRC = "https://example.com/episode.mp4"

const SPAN_MAP = [
  { proxyStartMs: 0, proxyEndMs: 3500, sourceStartMs: 0, firstFrame: 0, frameCount: 7 },
  { proxyStartMs: 3500, proxyEndMs: 8500, sourceStartMs: 10_300, firstFrame: 7, frameCount: 10 },
]
const CUTS = [1650.5, 12_034.367]
const ENCODED = { outPath: "/tmp/media-proxy-work/proxy.mp4", spanMap: SPAN_MAP, frame: { w: 960, h: 540 }, frameCount: 17, cuts: CUTS }
const SC = `sc${SCENE_CUT_RECIPE}`
const SPANS = [{ startMs: 10_300, endMs: 14_900 }, { startMs: 0, endMs: 3300 }]
const DETECT = { fps: 2, height: 540, spans: SPANS }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createWorkDir).mockResolvedValue("/tmp/media-proxy-work")
  vi.mocked(getR2ObjectSize).mockResolvedValue(0)
  vi.mocked(hasAudioStream).mockResolvedValue(true)
  vi.mocked(readR2ObjectBuffer).mockResolvedValue(null)
  vi.mocked(encodeVideoProxy).mockResolvedValue(ENCODED)
})

describe("mediaProxyKey", () => {
  it("is stable for the same source/kind/fps and under the proxies/ prefix", () => {
    expect(mediaProxyKey(SRC, "audio")).toBe(mediaProxyKey(SRC, "audio"))
    expect(mediaProxyKey(SRC, "audio")).toMatch(/^proxies\/[0-9a-f]{40}\/audio-v2\.m4a$/)
    expect(mediaProxyKey(SRC, "video", { fps: 15 })).toMatch(new RegExp(`^proxies/[0-9a-f]{40}/video-v3@15fps-360p-${SC.replace(/\./g, "\\.")}\\.mp4$`))
    expect(mediaProxyKey(SRC, "video", DETECT)).toMatch(new RegExp(`^proxies/[0-9a-f]{40}/video-v3@2fps-540p-${SC.replace(/\./g, "\\.")}-spans-[0-9a-f]{16}\\.mp4$`))
  })

  it("varies by kind, by fps, by height, by spans and by source", () => {
    expect(mediaProxyKey(SRC, "audio")).not.toBe(mediaProxyKey(SRC, "video"))
    expect(mediaProxyKey(SRC, "video", { fps: 2 })).not.toBe(mediaProxyKey(SRC, "video", { fps: 15 }))
    expect(mediaProxyKey(SRC, "video", { fps: 2, height: 540 })).not.toBe(mediaProxyKey(SRC, "video", { fps: 2, height: 360 }))
    expect(mediaProxyKey(SRC, "video", DETECT)).not.toBe(mediaProxyKey(SRC, "video", { fps: 2, height: 540 }))
    expect(mediaProxyKey(SRC, "video", DETECT)).not.toBe(mediaProxyKey(SRC, "video", { ...DETECT, spans: [{ startMs: 0, endMs: 3300 }] }))
    expect(mediaProxyKey(SRC, "audio")).not.toBe(mediaProxyKey("https://other/x.mp4", "audio"))
  })

  it("names the scene-cut rule, so a rule change re-encodes instead of serving another rule's cuts", () => {
    expect(mediaProxyKey(SRC, "video", { fps: 2 })).toContain(`-${SC}`)
    expect(mediaProxyKey(SRC, "audio")).not.toContain("-sc")
  })

  it("is the same for equivalent spans: order, overlaps and sub-ms noise do not split the cache", () => {
    const same = [{ startMs: 0, endMs: 2000 }, { startMs: 1500.2, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }]
    expect(mediaProxyKey(SRC, "video", { ...DETECT, spans: same })).toBe(mediaProxyKey(SRC, "video", DETECT))
  })

  it("keeps the span map beside the proxy", () => {
    expect(mediaProxyManifestKey(mediaProxyKey(SRC, "video", DETECT))).toBe(mediaProxyKey(SRC, "video", DETECT).replace(/\.mp4$/, ".json"))
  })
})

describe("ensureMediaProxy — cache hit", () => {
  it("returns the cached url without downloading or encoding", async () => {
    vi.mocked(getR2ObjectSize).mockResolvedValue(4242)
    const r = await ensureMediaProxy(SRC, "audio")
    expect(r.cached).toBe(true)
    expect(r.url).toBe(`https://cdn.test/${mediaProxyKey(SRC, "audio")}`)
    expect(downloadFile).not.toHaveBeenCalled()
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(uploadLocalFileToR2Key).not.toHaveBeenCalled()
  })
})

describe("ensureMediaProxy — cache miss", () => {
  it("downloads, encodes an audio proxy (16kHz mono AAC, no video), uploads, cleans up", async () => {
    const r = await ensureMediaProxy(SRC, "audio")
    expect(r.cached).toBe(false)
    expect(downloadFile).toHaveBeenCalledOnce()
    // The original behind a proxy is big media: the staged limits (Track 0.19).
    expect(vi.mocked(downloadFile).mock.calls[0][2]).toEqual({ limits: expect.objectContaining({ maxMs: expect.any(Number) }) })
    const [args, timeout] = vi.mocked(runFfmpeg).mock.calls[0]
    const a = args.join(" ")
    expect(a).toContain("-vn")
    expect(a).toContain("-ac 1")
    expect(a).toContain("-ar 16000")
    expect(a).toContain("-c:a aac")
    // keeps the source's clock: a leading gap is padded, never dropped
    expect(a).toContain("aresample=async=1:min_hard_comp=0.01:first_pts=0")
    expect(timeout).toBeGreaterThan(10 * 60_000) // longer than the default per-spawn ceiling
    expect(uploadLocalFileToR2Key).toHaveBeenCalledOnce()
    expect(cleanupWorkDir).toHaveBeenCalledWith("/tmp/media-proxy-work")
  })

  it("a video proxy defaults to 360 px tall over the whole source", async () => {
    await ensureMediaProxy(SRC, "video", { fps: 2 })
    expect(encodeVideoProxy).toHaveBeenCalledWith("/tmp/media-proxy-work/source", "/tmp/media-proxy-work", expect.objectContaining({ fps: 2, height: 360, spans: undefined }))
  })

  it("an audio proxy of a source with no audio track is a typed error, checked on the downloaded file before any encode", async () => {
    vi.mocked(hasAudioStream).mockResolvedValueOnce(false)
    const err = await ensureMediaProxy(SRC, "audio").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MediaHasNoAudioError)
    expect(err).toBeInstanceOf(DeterministicJobError) // one failure, no re-download per retry
    expect(vi.mocked(hasAudioStream).mock.calls[0][0]).toBe("/tmp/media-proxy-work/source")
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(uploadLocalFileToR2Key).not.toHaveBeenCalled()
    expect(cleanupWorkDir).toHaveBeenCalledWith("/tmp/media-proxy-work")
  })

  it("a video proxy never asks for an audio track", async () => {
    await ensureMediaProxy(SRC, "video", { fps: 2 })
    expect(hasAudioStream).not.toHaveBeenCalled()
  })
})

describe("ensureMediaProxy — video with spans (the detection proxy)", () => {
  it("encodes only the normalized spans, at the asked fps and height, and returns the span map from the cut", async () => {
    const r = await ensureMediaProxy(SRC, "video", DETECT)
    expect(r.cached).toBe(false)
    expect(encodeVideoProxy).toHaveBeenCalledOnce()
    const [, , opts] = vi.mocked(encodeVideoProxy).mock.calls[0]
    expect(opts).toMatchObject({ fps: 2, height: 540, spans: [{ startMs: 0, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }] })
    expect(r.spanMap).toEqual(SPAN_MAP)
    expect(r.frame).toEqual({ w: 960, h: 540 })
    expect(r.frameCount).toBe(17)
    expect(r.cuts).toEqual(CUTS)
    expect(r.fps).toBe(2)
    expect(r.url).toBe(`https://cdn.test/${mediaProxyKey(SRC, "video", DETECT)}`)
  })

  it("writes the proxy first and its span map second, so a half-written pair reads as a miss", async () => {
    await ensureMediaProxy(SRC, "video", DETECT)
    const key = mediaProxyKey(SRC, "video", DETECT)
    expect(vi.mocked(uploadLocalFileToR2Key).mock.calls[0][1]).toBe(key)
    const [body, manifestKey] = vi.mocked(uploadBufferToR2).mock.calls[0]
    expect(manifestKey).toBe(mediaProxyManifestKey(key))
    expect(vi.mocked(uploadLocalFileToR2Key).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(uploadBufferToR2).mock.invocationCallOrder[0])
    expect(JSON.parse(body.toString("utf8"))).toMatchObject({
      version: 2, fps: 2, height: 540, spanMap: SPAN_MAP, frame: { w: 960, h: 540 }, frameCount: 17,
      cuts: CUTS, cutRecipe: SCENE_CUT_RECIPE,
    })
  })

  it("a cache hit returns the stored span map and cuts without downloading or encoding", async () => {
    vi.mocked(getR2ObjectSize).mockResolvedValue(4242)
    vi.mocked(readR2ObjectBuffer).mockResolvedValue(Buffer.from(JSON.stringify({
      version: 2, fps: 2, height: 540, spanMap: SPAN_MAP, frame: { w: 960, h: 540 }, frameCount: 17, cuts: CUTS, cutRecipe: SCENE_CUT_RECIPE,
    })))
    const r = await ensureMediaProxy(SRC, "video", DETECT)
    expect(r.cached).toBe(true)
    expect(r.spanMap).toEqual(SPAN_MAP)
    expect(r.cuts).toEqual(CUTS)
    expect(vi.mocked(readR2ObjectBuffer).mock.calls[0][0]).toBe(mediaProxyManifestKey(mediaProxyKey(SRC, "video", DETECT)))
    expect(downloadFile).not.toHaveBeenCalled()
    expect(encodeVideoProxy).not.toHaveBeenCalled()
  })

  it("a proxy with no span map beside it (or an unreadable one) is re-encoded, never served without its clock", async () => {
    vi.mocked(getR2ObjectSize).mockResolvedValue(4242)
    const v1 = { version: 1, fps: 2, height: 540, spanMap: SPAN_MAP, frame: { w: 960, h: 540 }, frameCount: 17 }
    const v2 = { ...v1, version: 2, cuts: CUTS, cutRecipe: SCENE_CUT_RECIPE }
    for (const manifest of [
      null,
      Buffer.from("{not json"),
      Buffer.from(JSON.stringify({ version: 1, spanMap: "nope" })),
      // P3.2's manifest has no cuts: re-encoded, never served cutless
      Buffer.from(JSON.stringify(v1)),
      Buffer.from(JSON.stringify({ ...v2, cuts: undefined })),
      Buffer.from(JSON.stringify({ ...v2, cuts: [5000, 1000] })),
      Buffer.from(JSON.stringify({ ...v2, cuts: [1000, Number.NaN] })),
      // cuts found by another rule are not this proxy's cuts
      Buffer.from(JSON.stringify({ ...v2, cutRecipe: "t1-r1-f1" })),
    ]) {
      vi.mocked(encodeVideoProxy).mockClear()
      vi.mocked(readR2ObjectBuffer).mockResolvedValueOnce(manifest)
      const r = await ensureMediaProxy(SRC, "video", DETECT)
      expect(r.cached).toBe(false)
      expect(encodeVideoProxy).toHaveBeenCalledOnce()
    }
  })

  it("refuses bad spans before any download", async () => {
    const err = await ensureMediaProxy(SRC, "video", { fps: 2, height: 540, spans: [] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InvalidProxySpansError)
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it("refuses a height or fps it cannot encode before any download", async () => {
    for (const bad of [{ fps: 0, height: 540 }, { fps: Number.NaN, height: 540 }, { fps: 2, height: 541 }, { fps: 2, height: 0 }, { fps: 2, height: 99_999 }]) {
      await expect(ensureMediaProxy(SRC, "video", bad)).rejects.toBeInstanceOf(DeterministicJobError)
    }
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it("spans and height are video-only: an audio proxy given spans is a programming error", async () => {
    await expect(ensureMediaProxy(SRC, "audio", { spans: SPANS })).rejects.toThrow(/video/)
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it("cleans up the work dir even when the encode fails", async () => {
    vi.mocked(runFfmpeg).mockRejectedValueOnce(new Error("ffmpeg failed: boom"))
    await expect(ensureMediaProxy(SRC, "audio")).rejects.toThrow(/boom/)
    expect(cleanupWorkDir).toHaveBeenCalledWith("/tmp/media-proxy-work")
  })
})
