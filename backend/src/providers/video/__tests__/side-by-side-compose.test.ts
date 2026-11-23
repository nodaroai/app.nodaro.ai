import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `composeSideBySide`'s launch: the downloads are capped and carry the
 * caller's deadline, the launch waits for admission no longer than that, and
 * its memory reservation is the canvas it draws (bounded) with the decoders'
 * files at their own size.
 */
const fx = vi.hoisted(() => ({
  downloads: [] as Array<{ url: string; opts: Record<string, unknown> | undefined }>,
  launches: [] as Array<Record<string, unknown> | undefined>,
  probes: new Map<string, Record<string, unknown>>(),
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  downloadFile: async (url: string, _dest: string, opts?: Record<string, unknown>) => void fx.downloads.push({ url, opts }),
  probeVideoFrameCount: async () => 97,
  runFfmpeg: async (_args: string[], _timeout?: number, launch?: Record<string, unknown>) => (fx.launches.push(launch), ""),
}))
vi.mock("../matched-encode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../matched-encode.js")>()),
  probeMatchedOrThrow: async (path: string) => fx.probes.get(path.endsWith("original") ? "original" : "result"),
}))
vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegEffectiveThreads: () => ({ decode: 8, filter: 8, encode: 8 }),
}))

const { composeSideBySide, SIDE_BY_SIDE_MAX_INPUT_BYTES } = await import("../side-by-side.js")
const { canvasPeakMemoryMiB, cameraMegapixelsOf } = await import("../ffmpeg-memory-model.js")

const base = { videoCodec: "h264", pixFmt: "yuv420p", fpsRational: "24/1", nominalFpsRational: "24/1", colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709", colorRange: "tv" }
const compose = (signal?: AbortSignal) =>
  composeSideBySide({ originalUrl: "https://cdn.nodaro.ai/o.mp4", resultUrl: "https://cdn.nodaro.ai/r.mp4", startSec: 0, lengthSec: 4, workDir: "/w", ...(signal ? { signal } : {}) })

beforeEach(() => {
  fx.downloads = []
  fx.launches = []
  fx.probes.set("original", { ...base, width: 3840, height: 2160 })
  fx.probes.set("result", { ...base, width: 3840, height: 2160, videoBitRate: 40_000_000 })
})

describe("composeSideBySide", () => {
  it("caps both downloads and passes the caller's deadline to them and to the launch", async () => {
    const signal = new AbortController().signal
    await compose(signal)
    expect(fx.downloads.map((d) => d.opts)).toEqual([
      { maxBytes: SIDE_BY_SIDE_MAX_INPUT_BYTES, signal },
      { maxBytes: SIDE_BY_SIDE_MAX_INPUT_BYTES, signal },
    ])
    expect(fx.launches.every((l) => l?.signal === signal)).toBe(true)
  })

  it("renders a 4K result on a canvas of two 1080p panes, reserving for that canvas and the 4K decoders", async () => {
    const out = await compose()
    expect(out).toMatchObject({ width: 1920, height: 2160, layout: "stack" })
    const expected = canvasPeakMemoryMiB({ width: 1920, height: 2160 }, 2, { decode: 8, filter: 8, encode: 8 }, { inputs: 2, cameraMegapixels: cameraMegapixelsOf({ width: 3840, height: 2160 }), toneMap: false })
    expect(fx.launches[0]?.peakMemoryMiB).toBe(expected)
    // Well under the unbounded 4K pair's.
    expect(expected).toBeLessThan(canvasPeakMemoryMiB({ width: 3840, height: 4320 }, 2, { decode: 8, filter: 8, encode: 8 }, { inputs: 2, cameraMegapixels: 8.2944 }) / 2)
  })
})
