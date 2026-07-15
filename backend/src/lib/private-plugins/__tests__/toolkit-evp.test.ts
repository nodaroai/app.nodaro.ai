/**
 * Task 10 unit coverage for the edit-video-pro toolkit members that carry
 * real logic: `ffmpeg.trimVideo`, `ffmpeg.probeVideoMeta`, the
 * `ffmpeg.combineVideos` targetWidth/targetHeight threading, and
 * `http.computeEditVideoProPricing`.
 *
 * Mocking convention mirrors `load.ts`/`load.test.ts`'s `hasCredits` shim
 * handling and `toolkit-gvp.test.ts`'s general approach in this same
 * directory: partial-mock `@/lib/config.js` (preserve the real module,
 * override only `hasCredits`) — a full replacement blows away `config` for
 * every transitively-imported provider module `toolkit.ts` statically
 * imports (e.g. `providers/replicate/client.ts` reads
 * `config.REPLICATE_API_TOKEN` at module-eval time; see `load.test.ts`'s
 * header comment for the same rationale). Full-replace the narrow
 * video/storage modules these members actually call — same style as
 * `workers/handlers/__tests__/ffmpeg.test.ts`'s mocks of the same modules
 * (only the subset of named exports `toolkit.ts` itself imports).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockHasCreditsRef,
  mockTrimVideoCore,
  mockProbeVideoSource,
  mockCombineVideosCore,
  mockUploadFileToR2,
  mockFsRm,
  mockComputeEditVideoProPricing,
} = vi.hoisted(() => ({
  mockHasCreditsRef: { value: true },
  mockTrimVideoCore: vi.fn(),
  mockProbeVideoSource: vi.fn(),
  mockCombineVideosCore: vi.fn(),
  mockUploadFileToR2: vi.fn(),
  mockFsRm: vi.fn().mockResolvedValue(undefined),
  mockComputeEditVideoProPricing: vi.fn(),
}))

vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    hasCredits: () => mockHasCreditsRef.value,
  }
})

vi.mock("@/providers/video/trim-video.js", () => ({
  trimVideo: mockTrimVideoCore,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  runFfmpeg: vi.fn(),
  runFfmpegCapture: vi.fn(),
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn(),
  downloadFile: vi.fn(),
  probeVideoSource: mockProbeVideoSource,
  // video-analysis toolkit members (not exercised by the evp suite):
  runFfprobe: vi.fn(),
  getVideoDuration: vi.fn(),
  probeMediaDuration: vi.fn(),
  needsTranscode: vi.fn(),
  transcodeToBrowserSafe: vi.fn(),
  needsContainerRemux: vi.fn(),
  remuxToMp4: vi.fn(),
}))

vi.mock("@/providers/video/combine-videos.js", () => ({
  combineVideos: mockCombineVideosCore,
}))

vi.mock("@/lib/storage.js", () => ({
  uploadBufferToR2: vi.fn(),
  uploadFileToR2: mockUploadFileToR2,
  uploadToR2: vi.fn(),
  // video-analysis toolkit members (not exercised by the evp suite):
  uploadFileWithKeyToR2: vi.fn(),
  r2Url: vi.fn(),
  getR2ObjectSize: vi.fn(),
  downloadR2ObjectToFile: vi.fn(),
  readR2ObjectBuffer: vi.fn(),
  deleteFromR2: vi.fn(),
}))

// Preserve the real node:fs (toolkit.ts now transitively imports
// youtube-video.ts, which calls existsSync at module load via resolveYtDlpBin)
// while overriding only promises.rm for the combineVideos cleanup assertion.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, rm: mockFsRm } }
})

// http.computeEditVideoProPricing reaches ee/ via the same runtime-gated
// dynamic import() shim as computeGenerateVideoProPricing (toolkit.ts may
// not statically import ee/) — mock its target module so the gate test
// doesn't need a real ee/ build. Mirrors load.test.ts's `@/ee/billing/credits.js`
// mock for the same shim pattern (applyStaticCreditCosts).
vi.mock("@/ee/billing/edit-video-pro-credits.js", () => ({
  computeEditVideoProPricing: mockComputeEditVideoProPricing,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"

describe("toolkit.ts — edit-video-pro members", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
    mockFsRm.mockResolvedValue(undefined)
    tk = buildToolkit()
  })

  describe("ffmpeg.trimVideo", () => {
    it("calls core trimVideo with {videoUrl,startTime,endTime,crf}, uploads result, cleans temp dir, returns URL", async () => {
      mockTrimVideoCore.mockResolvedValue({ videoPath: "/tmp/trim-xyz/output.mp4" })
      mockUploadFileToR2.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")

      const url = await tk.ffmpeg.trimVideo("https://src.example.com/a.mp4", 5, 15, "job-1", { crf: 18 })

      expect(mockTrimVideoCore).toHaveBeenCalledWith({
        videoUrl: "https://src.example.com/a.mp4",
        startTime: 5,
        endTime: 15,
        crf: 18,
      })
      expect(mockUploadFileToR2).toHaveBeenCalledWith("/tmp/trim-xyz/output.mp4", "job-1", "video")
      expect(mockFsRm).toHaveBeenCalledWith("/tmp/trim-xyz", { recursive: true, force: true })
      expect(url).toBe("https://r2.example.com/videos/job-1.mp4")
    })

    it("endSec undefined → no endTime passed (open-ended cut)", async () => {
      mockTrimVideoCore.mockResolvedValue({ videoPath: "/tmp/trim-abc/output.mp4" })
      mockUploadFileToR2.mockResolvedValue("https://r2.example.com/videos/job-2.mp4")

      await tk.ffmpeg.trimVideo("https://src.example.com/b.mp4", 5, undefined, "job-2")

      expect(mockTrimVideoCore).toHaveBeenCalledWith({
        videoUrl: "https://src.example.com/b.mp4",
        startTime: 5,
      })
      const callArg = mockTrimVideoCore.mock.calls[0]![0] as Record<string, unknown>
      expect(callArg).not.toHaveProperty("endTime")
      expect(callArg).not.toHaveProperty("crf")
    })
  })

  describe("ffmpeg.probeVideoMeta", () => {
    it("renames durationSeconds → durationSec", async () => {
      mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 12.5 })

      await expect(tk.ffmpeg.probeVideoMeta("https://src.example.com/c.mp4")).resolves.toEqual({
        width: 1920,
        height: 1080,
        durationSec: 12.5,
      })
      expect(mockProbeVideoSource).toHaveBeenCalledWith("https://src.example.com/c.mp4")
    })
  })

  describe("ffmpeg.combineVideos", () => {
    it("threads targetWidth/targetHeight through to core combineVideos", async () => {
      // combineVideos returns CombineVideosResult ({outputPath, smartCuts?})
      // as of PR #81 — combineVideosToUrl destructures `outputPath`.
      mockCombineVideosCore.mockResolvedValue({ outputPath: "/tmp/combine-xyz/output.mp4" })
      mockUploadFileToR2.mockResolvedValue("https://r2.example.com/videos/combined.mp4")

      await tk.ffmpeg.combineVideos({
        videoUrls: ["https://a.mp4", "https://b.mp4"],
        transition: "cut",
        targetWidth: 1920,
        targetHeight: 1080,
      })

      expect(mockCombineVideosCore).toHaveBeenCalledWith(
        expect.objectContaining({ targetWidth: 1920, targetHeight: 1080 }),
      )
    })

    it("threads smartCut through to core combineVideos (gvp/evp stitch boundary matcher)", async () => {
      mockCombineVideosCore.mockResolvedValue({ outputPath: "/tmp/combine-xyz/output.mp4" })
      mockUploadFileToR2.mockResolvedValue("https://r2.example.com/videos/combined.mp4")

      await tk.ffmpeg.combineVideos({
        videoUrls: ["https://a.mp4", "https://b.mp4"],
        transition: "cut",
        smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
      })

      expect(mockCombineVideosCore).toHaveBeenCalledWith(
        expect.objectContaining({ smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 } }),
      )
    })

    it("omitted smartCut stays undefined at the core call (fixed trims — pre-smart-cut behavior)", async () => {
      mockCombineVideosCore.mockResolvedValue({ outputPath: "/tmp/combine-xyz/output.mp4" })
      mockUploadFileToR2.mockResolvedValue("https://r2.example.com/videos/combined.mp4")

      await tk.ffmpeg.combineVideos({
        videoUrls: ["https://a.mp4", "https://b.mp4"],
        transition: "cut",
      })

      expect(mockCombineVideosCore.mock.calls.at(-1)![0].smartCut).toBeUndefined()
    })
  })

  describe("http.computeEditVideoProPricing", () => {
    it("throws outside Cloud (hasCredits false); dynamic-imports the ee helper when cloud", async () => {
      mockHasCreditsRef.value = false

      await expect(
        tk.http.computeEditVideoProPricing({ provider: "kie", spanStart: 0, spanEnd: 10 }),
      ).rejects.toThrow(/Cloud-edition/)
      expect(mockComputeEditVideoProPricing).not.toHaveBeenCalled()

      mockHasCreditsRef.value = true
      const pricingResult = {
        mode: "replace" as const,
        spanStartSec: 0,
        spanEndSec: 10,
        clampedSpanSec: 10,
        maxSpanSec: 120,
        segmentCount: 1,
        segmentDurations: [10],
        totalRawSec: 10,
        refsSecReserve: 2,
        outerSeamLossReserve: 0.3,
        feeBase: 4,
        refPerSecByResolution: { "720p": 1.5 },
        reserveResolution: "720p",
        reserveBase: 20,
        probe: { width: 1280, height: 720, durationSec: 30 },
        spanExceedsSource: false,
      }
      mockComputeEditVideoProPricing.mockResolvedValue(pricingResult)

      const args = { provider: "kie", sourceUrl: "https://src.example.com/d.mp4", spanStart: 0, spanEnd: 10 }
      const result = await tk.http.computeEditVideoProPricing(args)

      expect(mockComputeEditVideoProPricing).toHaveBeenCalledWith(args)
      expect(result).toBe(pricingResult)
    })
  })
})
