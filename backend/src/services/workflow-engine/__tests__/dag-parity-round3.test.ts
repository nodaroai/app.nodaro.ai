/**
 * Regression tests for DAG execution parity — round 3.
 *
 * Context: the 2026-06-21 DAG-vs-single-node parity audit found 12 cases where
 * backend orchestrator (workflow / app / webhook) execution produced different
 * RESULTS or CHARGED differently than a single-node "Run". These tests lock in
 * the fixes so future edits to payload-builder can't silently re-introduce the
 * drift. Each `describe` maps to one audit row.
 *
 * The recurring root cause: payload-builder.ts is a parallel re-implementation
 * of what each route handler builds, and it had fallen behind when a node
 * gained a param / mode / credit dimension (the route + frontend were updated,
 * payload-builder was forgotten). The shared credit-ID builders
 * (`resolveImageGenCreditIdentifier`, `resolveEntityImageCreditIdentifier`) and
 * the shared `buildMusicPrompt` helper close the divergence at the source.
 */

import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

const JOB_ID = "job-1"

// ---------------------------------------------------------------------------
// FUNCTIONAL #1 — generate-music folds genre/mood/instrumental into the prompt
// (the route does this; the worker only reads `prompt`, so the DAG dropping the
//  enrichment made those three controls no-ops in workflow runs).
// ---------------------------------------------------------------------------

describe("generate-music — genre/mood/instrumental folded into prompt", () => {
  it("appends genre, mood and the instrumental tag like the route", () => {
    const n = node("m1", "generate-music", {
      prompt: "a jazzy tune",
      genre: "lo-fi",
      mood: "melancholic",
      instrumental: true,
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.prompt).toBe("a jazzy tune, lo-fi, melancholic, instrumental, no vocals")
  })

  it("leaves the prompt untouched when no music meta is set", () => {
    const n = node("m1", "generate-music", { prompt: "a jazzy tune" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.prompt).toBe("a jazzy tune")
  })

  it("omits the instrumental tag when instrumental is false", () => {
    const n = node("m1", "generate-music", { prompt: "a jazzy tune", genre: "lo-fi" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.prompt).toBe("a jazzy tune, lo-fi")
  })
})

// ---------------------------------------------------------------------------
// FUNCTIONAL #2 — trim-video forwards seconds / keep-first / keep-last modes
// (DAG only handled time/frames/smart-loop-cut → those three modes passed the
//  video through untrimmed in workflow runs).
// ---------------------------------------------------------------------------

describe("trim-video — non-time trim modes forwarded to the worker", () => {
  it("forwards trimStartSeconds/trimEndSeconds in seconds mode", () => {
    const n = node("t1", "trim-video", {
      videoUrl: "https://v.mp4",
      trimMode: "seconds",
      trimStartSeconds: 2,
      trimEndSeconds: 8,
    })
    const r = buildPayload(n, JOB_ID, {})
    expect(r.payload.trimStartSeconds).toBe(2)
    expect(r.payload.trimEndSeconds).toBe(8)
  })

  it("forwards keepFirstSeconds in keep-first-seconds mode", () => {
    const n = node("t1", "trim-video", {
      videoUrl: "https://v.mp4",
      trimMode: "keep-first-seconds",
      keepFirstSeconds: 5,
    })
    expect(buildPayload(n, JOB_ID, {}).payload.keepFirstSeconds).toBe(5)
  })

  it("forwards keepLastSeconds in keep-last-seconds mode", () => {
    const n = node("t1", "trim-video", {
      videoUrl: "https://v.mp4",
      trimMode: "keep-last-seconds",
      keepLastSeconds: 3,
    })
    expect(buildPayload(n, JOB_ID, {}).payload.keepLastSeconds).toBe(3)
  })

  it("does not leak seconds fields when in time mode", () => {
    const n = node("t1", "trim-video", { videoUrl: "https://v.mp4", trimMode: "time", startTime: 1, endTime: 4 })
    const r = buildPayload(n, JOB_ID, {})
    expect(r.payload.trimStartSeconds).toBeUndefined()
    expect(r.payload.keepFirstSeconds).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// FUNCTIONAL #3 — extract-frame forwards frameIndex / framesFromEnd
// (DAG only sent mode+timestamp → frame-index/frame-from-end always returned
//  the first/last frame regardless of the chosen index).
// ---------------------------------------------------------------------------

describe("extract-frame — index modes forwarded to the worker", () => {
  it("forwards frameIndex in frame-index mode", () => {
    const n = node("e1", "extract-frame", { videoUrl: "https://v.mp4", mode: "frame-index", frameIndex: 42 })
    expect(buildPayload(n, JOB_ID, {}).payload.frameIndex).toBe(42)
  })

  it("forwards framesFromEnd in frame-from-end mode", () => {
    const n = node("e1", "extract-frame", { videoUrl: "https://v.mp4", mode: "frame-from-end", framesFromEnd: 3 })
    expect(buildPayload(n, JOB_ID, {}).payload.framesFromEnd).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// FUNCTIONAL #4 — combine-videos forwards audioCrossfadeCurve
// (DAG dropped it → non-default curves fell back to linear in workflow runs).
// ---------------------------------------------------------------------------

describe("combine-videos — forwards audioCrossfadeCurve", () => {
  it("passes a non-default crossfade curve through", () => {
    const n = node("c1", "combine-videos", {
      videoUrls: ["https://a.mp4", "https://b.mp4"],
      audioCrossfadeCurve: "equal-power",
    })
    expect(buildPayload(n, JOB_ID, {}).payload.audioCrossfadeCurve).toBe("equal-power")
  })
})

// ---------------------------------------------------------------------------
// FUNCTIONAL #5 — combine-audio respects segmentOrder
// (DAG computed a reordered list then discarded it, concatenating in arrival
//  order instead of the user-arranged order).
// ---------------------------------------------------------------------------

describe("combine-audio — segments built in segmentOrder", () => {
  it("reorders segments to match segmentOrder", () => {
    const n = node("c1", "combine-audio", { segmentOrder: ["a2", "a1"] })
    const inputs: ResolvedInputs = {
      audioUrlsWithSourceIds: [
        { nodeId: "a1", url: "https://1.mp3" },
        { nodeId: "a2", url: "https://2.mp3" },
      ],
    }
    const r = buildPayload(n, JOB_ID, inputs)
    const urls = (r.payload.segments as Array<{ url: string }>).map((s) => s.url)
    expect(urls).toEqual(["https://2.mp3", "https://1.mp3"])
  })

  it("keeps arrival order when no segmentOrder is set", () => {
    const n = node("c1", "combine-audio", {})
    const inputs: ResolvedInputs = {
      audioUrlsWithSourceIds: [
        { nodeId: "a1", url: "https://1.mp3" },
        { nodeId: "a2", url: "https://2.mp3" },
      ],
    }
    const r = buildPayload(n, JOB_ID, inputs)
    const urls = (r.payload.segments as Array<{ url: string }>).map((s) => s.url)
    expect(urls).toEqual(["https://1.mp3", "https://2.mp3"])
  })
})

// ---------------------------------------------------------------------------
// FUNCTIONAL #6 — image-to-video forwards videoTrimStart / videoTrimEnd
// (DAG dropped the trim window → the un-trimmed full clip was produced).
// ---------------------------------------------------------------------------

describe("image-to-video — forwards videoTrimStart/videoTrimEnd", () => {
  it("passes the trim window through to the worker", () => {
    const n = node("v1", "image-to-video", { provider: "kling", videoTrimStart: 1, videoTrimEnd: 9 })
    const r = buildPayload(n, JOB_ID, { imageUrl: "https://i.png" })
    expect(r.payload.videoTrimStart).toBe(1)
    expect(r.payload.videoTrimEnd).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// FUNCTIONAL #7 — add-captions reads camelCase autoTranscribe/transcribeProvider
// (DAG read snake_case data.auto_transcribe → always undefined; an explicit
//  autoTranscribe:false and any transcribeProvider choice were silently dropped.
//  The job payload keeps snake_case because that is the worker contract.)
// ---------------------------------------------------------------------------

describe("add-captions — honours camelCase node fields", () => {
  it("maps data.autoTranscribe=false to payload.auto_transcribe=false", () => {
    const n = node("a1", "add-captions", {
      autoTranscribe: false,
      transcribeProvider: "whisper",
      style: "word-pop",
    })
    const r = buildPayload(n, JOB_ID, { videoUrl: "https://v.mp4" })
    expect(r.payload.auto_transcribe).toBe(false)
    expect(r.payload.transcribe_provider).toBe("whisper")
  })

  it("maps data.autoTranscribe=true through", () => {
    const n = node("a1", "add-captions", { autoTranscribe: true, style: "word-pop" })
    const r = buildPayload(n, JOB_ID, { videoUrl: "https://v.mp4" })
    expect(r.payload.auto_transcribe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CREDIT #8 — generate-image: reference count + T2I→I2I swap drive the credit id
// (DAG omitted refCount and the provider swap → Flux 2 family billed the
//  cheapest :0ref tier with no metered true-up).
// ---------------------------------------------------------------------------

describe("generate-image — reference-aware credit identifier", () => {
  it("encodes the assembled ref count for the Flux 2 family", () => {
    const n = node("g1", "generate-image", {
      provider: "flux-2-max",
      resolution: "2",
      referenceImageUrls: [{ id: "r1", url: "https://r1.png" }],
    })
    expect(buildPayload(n, JOB_ID, {}).modelIdentifier).toBe("flux-2-max:2MP:1ref")
  })

  it("charges the 0-ref tier for a pure text-to-image Flux 2 run", () => {
    const n = node("g1", "generate-image", { provider: "flux-2-max", resolution: "2" })
    expect(buildPayload(n, JOB_ID, {}).modelIdentifier).toBe("flux-2-max:2MP:0ref")
  })

  it("swaps a T2I provider to its i2i variant for credit when refs are attached", () => {
    const n = node("g1", "generate-image", { provider: "grok" })
    const r = buildPayload(n, JOB_ID, { referenceImageUrls: ["https://r1.png"] })
    expect(r.modelIdentifier).toBe("grok-i2i")
  })
})

// ---------------------------------------------------------------------------
// CREDIT #9/#10 — image-to-image / modify-image count the primary image as a ref
// ---------------------------------------------------------------------------

describe("image-to-image / modify-image — primary image counts as a ref (Flux 2)", () => {
  it("image-to-image with only the primary image is :1ref", () => {
    const n = node("i1", "image-to-image", { provider: "flux-2-pro", resolution: "1" })
    const r = buildPayload(n, JOB_ID, { imageUrl: "https://main.png" })
    expect(r.modelIdentifier).toBe("flux-2-pro:1MP:1ref")
  })

  it("modify-image (i2i branch) with only the primary image is :1ref", () => {
    const n = node("m1", "modify-image", { provider: "flux-2-pro", resolution: "1" })
    const r = buildPayload(n, JOB_ID, { imageUrl: "https://main.png" })
    expect(r.modelIdentifier).toBe("flux-2-pro:1MP:1ref")
  })
})

// ---------------------------------------------------------------------------
// CREDIT #11/#12 — character / location use the ref-aware entity credit id
// (DAG used the bare provider → Flux 2 entities charged the wrong tier; the
//  entity worker commits non-metered so the wrong reservation is the final
//  charge).
// ---------------------------------------------------------------------------

describe("character / location — ref-aware entity credit identifier", () => {
  it("character with a source image is :1ref on Flux 2", () => {
    const n = node("c1", "character", {
      name: "Aria",
      provider: "flux-2-max",
      resolution: "2",
      sourceImageUrl: "https://ref.png",
    })
    expect(buildPayload(n, JOB_ID, {}).modelIdentifier).toBe("flux-2-max:2MP:1ref")
  })

  it("character without a source image is :0ref on Flux 2", () => {
    const n = node("c1", "character", { name: "Aria", provider: "flux-2-max", resolution: "2" })
    expect(buildPayload(n, JOB_ID, {}).modelIdentifier).toBe("flux-2-max:2MP:0ref")
  })

  it("location with a source image is :1ref on Flux 2", () => {
    const n = node("l1", "location", {
      name: "Neo Tokyo",
      provider: "flux-2-max",
      resolution: "2",
      sourceImageUrl: "https://ref.png",
    })
    expect(buildPayload(n, JOB_ID, {}).modelIdentifier).toBe("flux-2-max:2MP:1ref")
  })

  it("character on the default provider keeps the bare identifier", () => {
    const n = node("c1", "character", { name: "Aria" })
    expect(buildPayload(n, JOB_ID, {}).modelIdentifier).toBe("nano-banana")
  })
})
