import { describe, it, expect } from "vitest"
import {
  ACCEPTS_VIDEO,
  ACCEPTS_AUDIO,
  ACCEPTS_MEDIA,
  FFMPEG_NODE_TYPES,
  FFMPEG_COLORS,
  isValidFfmpegConnection,
} from "../ffmpeg-handles"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"

/**
 * Drift catchers + behavioral tests for the ffmpeg / pure-processing handle
 * predicates. Two registries must stay in sync — when they don't, drops
 * silently fail at the canvas without any test catching them:
 *
 *  1. FFMPEG_NODE_TYPES (the short-circuit set in connection-validation.ts)
 *     and the switch cases in isValidFfmpegConnection MUST cover the same
 *     11 node types.
 *  2. TARGET_HANDLE_ACCEPTS MUST register every ffmpeg consumer so source-
 *     direction popovers can enumerate them via getTargetHandlesAccepting.
 *
 * Both gaps have shipped silent regressions in adjacent migrations
 * (generate-video, parameter pickers), so they're guarded explicitly here.
 */

const ALL_FFMPEG: ReadonlyArray<string> = [
  "trim-video",
  "combine-videos",
  "merge-video-audio",
  "extract-frame",
  "loop-video",
  "resize-video",
  "add-captions",
  "trim-audio",
  "adjust-volume",
  "combine-audio",
  "mix-audio",
]

describe("FFMPEG_NODE_TYPES set contents", () => {
  it("contains exactly the 11 expected node types", () => {
    expect(new Set(FFMPEG_NODE_TYPES)).toEqual(new Set(ALL_FFMPEG))
  })
})

describe("isValidFfmpegConnection switch coverage", () => {
  // A known-valid source per acceptor — used to assert that every node
  // type in FFMPEG_NODE_TYPES has a switch case (default-false would
  // reject all sources for an uncovered type).
  const VALID_SOURCE: Record<string, string> = {
    "trim-video":         "upload-video",
    "combine-videos":     "upload-video",
    "merge-video-audio":  "upload-video",
    "extract-frame":      "upload-video",
    "loop-video":         "upload-video",
    "resize-video":       "upload-video",
    "add-captions":       "upload-video",
    "trim-audio":         "upload-audio",
    "adjust-volume":      "upload-audio",
    "combine-audio":      "upload-audio",
    "mix-audio":          "upload-audio",
  }

  it("every node in FFMPEG_NODE_TYPES has a switch case that accepts at least one source", () => {
    for (const nt of FFMPEG_NODE_TYPES) {
      const known = VALID_SOURCE[nt]
      expect(known, `no known-valid source mapped for ${nt}`).toBeTruthy()
      expect(
        isValidFfmpegConnection(nt, "in", known),
        `${nt} fell through to default (case missing in switch)`,
      ).toBe(true)
    }
  })

  it("rejects unknown handle ids", () => {
    expect(isValidFfmpegConnection("trim-video", "subtitles", "upload-video")).toBe(false)
  })

  it("rejects unknown node types via default", () => {
    expect(isValidFfmpegConnection("unknown-ffmpeg-node", "in", "upload-video")).toBe(false)
  })
})

describe("TARGET_HANDLE_ACCEPTS coverage for ffmpeg consumers", () => {
  it("registers every ffmpeg node type", () => {
    for (const nt of FFMPEG_NODE_TYPES) {
      expect(
        TARGET_HANDLE_ACCEPTS[nt],
        `${nt} missing from TARGET_HANDLE_ACCEPTS — source-direction popovers won't enumerate it`,
      ).toBeDefined()
    }
  })

  it("every ffmpeg consumer registers an `in` handle entry", () => {
    for (const nt of FFMPEG_NODE_TYPES) {
      const entries = TARGET_HANDLE_ACCEPTS[nt] ?? []
      expect(entries.some((e) => e.handleId === "in")).toBe(true)
    }
  })
})

describe("ACCEPTS_VIDEO", () => {
  it("accepts pure video producers", () => {
    expect(ACCEPTS_VIDEO("upload-video")).toBe(true)
    expect(ACCEPTS_VIDEO("generate-video")).toBe(true)
    expect(ACCEPTS_VIDEO("trim-video")).toBe(true)
  })

  it("accepts dynamic producers whose runtime output can be video", () => {
    // adjust-volume is registered in AUDIO_PRODUCER_TYPES only, but its
    // output is video when lastInputType === "video". Without explicit
    // allowance, the strict validator would reject every adjust-volume →
    // video-ffmpeg edge after the user runs it on video.
    expect(ACCEPTS_VIDEO("adjust-volume")).toBe(true)
    expect(ACCEPTS_VIDEO("list")).toBe(true)
    expect(ACCEPTS_VIDEO("sub-workflow")).toBe(true)
  })

  it("rejects audio-only producers", () => {
    expect(ACCEPTS_VIDEO("text-to-speech")).toBe(false)
    expect(ACCEPTS_VIDEO("generate-music")).toBe(false)
    expect(ACCEPTS_VIDEO("upload-audio")).toBe(false)
  })

  it("rejects unrelated source types", () => {
    expect(ACCEPTS_VIDEO("text-prompt")).toBe(false)
    expect(ACCEPTS_VIDEO("character")).toBe(false)
    expect(ACCEPTS_VIDEO("")).toBe(false)
  })
})

describe("ACCEPTS_AUDIO", () => {
  it("accepts pure audio producers", () => {
    expect(ACCEPTS_AUDIO("upload-audio")).toBe(true)
    expect(ACCEPTS_AUDIO("text-to-speech")).toBe(true)
    expect(ACCEPTS_AUDIO("generate-music")).toBe(true)
  })

  it("accepts dynamic producers", () => {
    expect(ACCEPTS_AUDIO("adjust-volume")).toBe(true)
    expect(ACCEPTS_AUDIO("list")).toBe(true)
    expect(ACCEPTS_AUDIO("sub-workflow")).toBe(true)
  })

  it("rejects video-only producers", () => {
    expect(ACCEPTS_AUDIO("upload-video")).toBe(false)
    expect(ACCEPTS_AUDIO("generate-video")).toBe(false)
    expect(ACCEPTS_AUDIO("trim-video")).toBe(false)
  })
})

describe("ACCEPTS_MEDIA", () => {
  it("accepts both video and audio producers", () => {
    expect(ACCEPTS_MEDIA("upload-video")).toBe(true)
    expect(ACCEPTS_MEDIA("upload-audio")).toBe(true)
    expect(ACCEPTS_MEDIA("generate-video")).toBe(true)
    expect(ACCEPTS_MEDIA("text-to-speech")).toBe(true)
  })

  it("accepts dynamic producers", () => {
    expect(ACCEPTS_MEDIA("list")).toBe(true)
    expect(ACCEPTS_MEDIA("adjust-volume")).toBe(true)
  })

  it("rejects non-media source types", () => {
    expect(ACCEPTS_MEDIA("text-prompt")).toBe(false)
    expect(ACCEPTS_MEDIA("character")).toBe(false)
    expect(ACCEPTS_MEDIA("upload-image")).toBe(false)
  })
})

describe("FFMPEG_COLORS", () => {
  it("exposes distinct keys per pip category", () => {
    expect(FFMPEG_COLORS.video).toBeTruthy()
    expect(FFMPEG_COLORS.audio).toBeTruthy()
    expect(FFMPEG_COLORS.media).toBeTruthy()
    expect(FFMPEG_COLORS.image).toBeTruthy()
  })

  it("video and audio are distinct hexes", () => {
    expect(FFMPEG_COLORS.video).not.toEqual(FFMPEG_COLORS.audio)
  })
})
