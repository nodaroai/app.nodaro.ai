import { describe, expect, it } from "vitest"
import { geminiOmniExtendEstimateSource, geminiOmniExtendResolution } from "@nodaro/render-rules"
import { seedanceExtendSentSec } from "@nodaro/shared/credits"

// Decided 2026-11-17: what an estimate of Gemini Omni Flash 1.2 Extend reads
// of its source (the editor's quote and the server's run estimate alike).
const extend = { id: "x", type: "extend-video", data: { provider: "gemini-omni-flash-1-2-extend" } }
const wire = [{ source: "s", target: "x", targetHandle: "video" }]

describe("geminiOmniExtendResolution — never above the source's tier", () => {
  it.each([
    [{ width: 1280, height: 720 }, "4k", "720p"],
    [{ width: 1920, height: 1080 }, "4k", "1080p"],
    [{ width: 1080, height: 1920 }, "4k", "1080p"],
    [{ width: 854, height: 480 }, "4k", "720p"],
    [{ width: 640, height: 360 }, "1080p", "360p"],
    [{ width: 480, height: 270 }, "720p", "360p"],
    [{ width: 3840, height: 2160 }, "4k", "4k"],
    [{ width: 7680, height: 4320 }, "4k", "4k"],
    [{ width: 1920, height: 1080 }, "360p", "360p"],
    // A source a few lines over a tier is that tier (2% of its lines, at least 16), never the next one up.
    [{ width: 1920, height: 1088 }, "4k", "1080p"],
    [{ width: 1296, height: 736 }, "4k", "720p"],
    [{ width: 1280, height: 718 }, "4k", "720p"],
    [{ width: 1280, height: 737 }, "4k", "1080p"],
    [{ width: 1920, height: 1101 }, "4k", "1080p"],
    [{ width: 1920, height: 1102 }, "4k", "4k"],
    [{ width: 640, height: 376 }, "1080p", "360p"],
    [{ width: 640, height: 377 }, "1080p", "720p"],
    [{ width: 3840, height: 2176 }, "4k", "4k"],
    [undefined, "4k", "4k"],
    [{ width: 1920, height: 1080 }, "480p", "720p"],
  ] as const)("a %j source asked for %s runs at %s", (source, asked, tier) => {
    expect(geminiOmniExtendResolution(asked, source)).toBe(tier)
  })
})

describe("geminiOmniExtendEstimateSource", () => {
  it("an upload: its measured length as it is, and its recorded size", () => {
    const upload = { id: "s", type: "upload-video", data: { url: "https://m.test/s.mp4", duration: 4.37, videoDurationSec: 4.37, metadata: { width: 1280, height: 720 } } }
    expect(geminiOmniExtendEstimateSource(extend, [upload, extend], wire, new Set())).toEqual({ sourcePictureSec: 4.37, frame: { width: 1280, height: 720 } })
  })

  it("a made generation: its recorded length rounded UP to the whole second, so the quote is never below the hold", () => {
    for (const [recorded, rounded] of [[5.04, 6], [4.96, 5], [5, 5], [9.7, 10]] as const) {
      const made = { id: "s", type: "generate-video", data: { provider: "seedance-2-5", generatedResults: [{ url: "https://cdn.example.com/g.mp4", duration: recorded }], activeResultIndex: 0 } }
      const got = geminiOmniExtendEstimateSource(extend, [made, extend], wire, new Set())
      expect(got.sourcePictureSec, String(recorded)).toBe(rounded)
      // The file the run measures can sit up to a quarter second past its record:
      // the seconds the hold counts are never above the quoted ones.
      for (const extra of [0, 0.01, 0.1, 0.25]) {
        expect(seedanceExtendSentSec(recorded + extra), `${recorded}+${extra}`).toBeLessThanOrEqual(seedanceExtendSentSec(got.sourcePictureSec))
      }
    }
  })

  it("a generation that runs again, or no wire, is not known", () => {
    const made = { id: "s", type: "generate-video", data: { generatedResults: [{ url: "https://cdn.example.com/g.mp4", duration: 5 }] } }
    expect(geminiOmniExtendEstimateSource(extend, [made, extend], wire, new Set(["s"]))).toEqual({})
    expect(geminiOmniExtendEstimateSource(extend, [extend], [], new Set())).toEqual({})
  })
})
