import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, normalizeVideoRequestParams } from "@nodaro/shared/model-catalog"
import { VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"
import { pricedVideoSelection } from "@nodaro/shared/credits"
import {
  resolveVideoRequestNorm,
  videoRequestAsRun,
  videoRequestReferenceMedia,
} from "../video-request-norm.js"

// ---------------------------------------------------------------------------
// The one place a video request's catalog-governed params become what is
// priced, recorded and sent. A declared Seedance 2.5 reference task type is
// resolved FIRST, on the raw ratio and length, so every billing site sees the
// ratio and length it forces; a request that declares nothing goes through the
// two existing steps exactly as before.
// ---------------------------------------------------------------------------

/** The norm as it was before the task-type step: the two catalog steps alone. */
function todaysNorm(input: { provider: string; aspectRatio?: string; resolution?: string; duration?: number | string; draft?: boolean }) {
  const norm = normalizeVideoRequestParams(input.provider, {
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    draft: input.draft,
  })
  const priced = pricedVideoSelection({ provider: input.provider, resolution: norm.resolution, duration: input.duration })
  return {
    aspectRatio: norm.aspectRatio,
    resolution: norm.resolution ?? priced.resolution,
    duration: priced.duration,
    adjustments: [...norm.adjustments, ...priced.adjustments],
  }
}

const ONE_VIDEO = (sec: number | undefined) => ({ imageCount: 0, audioCount: 0, videoSec: [sec] })

describe("resolveVideoRequestNorm — a request that declares nothing is today's", () => {
  const CASES = [
    { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 },
    { provider: "seedance-2-5", aspectRatio: "9:21", resolution: "4k", duration: 7 },
    { provider: "seedance-2-5", duration: -1 },
    { provider: "seedance-2-5" },
    { provider: "seedance-2-5", resolution: "1080p", duration: 8, draft: true },
    { provider: "seedance-2-5", duration: "6" },
    { provider: "seedance-2", aspectRatio: "16:9", duration: 8 },
    { provider: "ltx-2.3-pro", duration: 7, resolution: "4k" },
    { provider: "kling-3.0", aspectRatio: "1:1", duration: 10 },
  ]

  for (const input of CASES) {
    it(`${JSON.stringify(input)} — no field, no media`, () => {
      expect(resolveVideoRequestNorm(input)).toStrictEqual(todaysNorm(input))
    })
    it(`${JSON.stringify(input)} — "auto" with a reference video`, () => {
      expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "auto", referenceMedia: ONE_VIDEO(6) })).toStrictEqual(todaysNorm(input))
    })
  }

  it("a declaration with no reference media given is dropped: ratio and length as today", () => {
    const input = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 }
    expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "edit" })).toStrictEqual(todaysNorm(input))
  })

  it("a model other than Seedance 2.5 ignores the field", () => {
    const input = { provider: "seedance-2", aspectRatio: "16:9", duration: 5 }
    expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "edit", referenceMedia: ONE_VIDEO(6) })).toStrictEqual(todaysNorm(input))
  })

  it("an unknown value is Auto", () => {
    const input = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 }
    expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "Edit", referenceMedia: ONE_VIDEO(6) })).toStrictEqual(todaysNorm(input))
  })
})

describe("resolveVideoRequestNorm — a declared reference task type", () => {
  it("edit with one 6 s clip runs adaptive at Auto length, and reports both changes", () => {
    const norm = resolveVideoRequestNorm({
      provider: "seedance-2-5",
      aspectRatio: "16:9",
      duration: 5,
      referenceTaskType: "edit",
      referenceMedia: ONE_VIDEO(6),
    })
    expect(norm).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1 })
    expect(norm.adjustments).toHaveLength(2)
    expect(norm.adjustments.map((a) => a.field).sort()).toEqual(["aspectRatio", "duration"])
  })

  it("edit runs at the ratio and resolution of the same request sent as adaptive / Auto", () => {
    const declared = resolveVideoRequestNorm({
      provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: "edit", referenceMedia: ONE_VIDEO(6),
    })
    const shaped = todaysNorm({ provider: "seedance-2-5", aspectRatio: "adaptive", duration: -1 })
    expect(declared.aspectRatio).toBe(shaped.aspectRatio)
    expect(declared.resolution).toBe(shaped.resolution)
  })

  it("edit with a clip that was not measured declares nothing", () => {
    const input = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 }
    expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "edit", referenceMedia: ONE_VIDEO(undefined) })).toStrictEqual(todaysNorm(input))
  })

  it("edit with a 3 s clip declares nothing", () => {
    const input = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 }
    expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "edit", referenceMedia: ONE_VIDEO(3) })).toStrictEqual(todaysNorm(input))
  })

  it("a draft declares nothing", () => {
    const input = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, draft: true }
    expect(resolveVideoRequestNorm({ ...input, referenceTaskType: "edit", referenceMedia: ONE_VIDEO(6) })).toStrictEqual(todaysNorm(input))
  })

  it("edit reads a string length the way the pricing helpers do", () => {
    const norm = resolveVideoRequestNorm({
      provider: "seedance-2-5", aspectRatio: "16:9", duration: "5", referenceTaskType: "edit", referenceMedia: ONE_VIDEO(6),
    })
    expect(norm).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1 })
    expect(norm.adjustments.find((a) => a.field === "duration")).toMatchObject({ from: 5, to: -1 })
  })

  it("extend with no length runs the model's default length, adaptive", () => {
    const norm = resolveVideoRequestNorm({
      provider: "seedance-2-5", aspectRatio: "16:9", referenceTaskType: "extend", referenceMedia: ONE_VIDEO(undefined),
    })
    expect(norm).toMatchObject({ referenceTaskType: "extend", aspectRatio: "adaptive", duration: MODEL_CATALOG["seedance-2-5"]!.defaultDuration })
  })

  it("extend keeps a set length", () => {
    const norm = resolveVideoRequestNorm({
      provider: "seedance-2-5", aspectRatio: "adaptive", duration: 12, referenceTaskType: "extend", referenceMedia: ONE_VIDEO(6),
    })
    expect(norm).toMatchObject({ referenceTaskType: "extend", aspectRatio: "adaptive", duration: 12 })
    expect(norm.adjustments).toEqual([])
  })

  it("reference is recorded and moves nothing", () => {
    const input = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 }
    const norm = resolveVideoRequestNorm({
      ...input, referenceTaskType: "reference", referenceMedia: { imageCount: 1, audioCount: 0, videoSec: [] },
    })
    expect(norm).toStrictEqual({ ...todaysNorm(input), referenceTaskType: "reference" })
  })
})

describe("videoRequestReferenceMedia — what the resolver counts", () => {
  it("counts the reference arrays and nothing else: a start or end frame is no reference", () => {
    const body: Record<string, unknown> = {
      imageUrl: "https://e.com/start.png",
      endFrameUrl: "https://e.com/end.png",
      referenceImageUrls: ["https://e.com/a.png", "https://e.com/b.png"],
      referenceAudioUrls: ["https://e.com/a.mp3"],
    }
    expect(videoRequestReferenceMedia(body, undefined)).toStrictEqual({ imageCount: 2, audioCount: 1, videoSec: [] })
  })

  it("a start frame alone is no reference media", () => {
    const body: Record<string, unknown> = { imageUrl: "https://e.com/start.png" }
    expect(videoRequestReferenceMedia(body, undefined)).toStrictEqual({ imageCount: 0, audioCount: 0, videoSec: [] })
  })

  it("one entry per reference video; a failed probe (NaN) or a missing one is unmeasured", () => {
    const urls = ["https://e.com/1.mp4", "https://e.com/2.mp4", "https://e.com/3.mp4"]
    expect(videoRequestReferenceMedia({ referenceVideoUrls: urls }, [6, Number.NaN]).videoSec).toStrictEqual([6, undefined, undefined])
    expect(videoRequestReferenceMedia({ referenceVideoUrls: urls }, undefined).videoSec).toStrictEqual([undefined, undefined, undefined])
  })
})

describe("videoRequestAsRun — the body pricing reads", () => {
  const body = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: "edit" }

  it("is the same object when nothing is declared, or the declaration moves nothing", () => {
    const none = resolveVideoRequestNorm({ provider: "seedance-2-5", aspectRatio: "16:9", duration: 5 })
    expect(videoRequestAsRun(body, none)).toBe(body)
    expect(videoRequestAsRun(body, undefined)).toBe(body)
    const reference = resolveVideoRequestNorm({
      provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: "reference", referenceMedia: ONE_VIDEO(6),
    })
    expect(videoRequestAsRun(body, reference)).toBe(body)
  })

  it("an edit reads as the same body sent at adaptive and Auto length", () => {
    const edit = resolveVideoRequestNorm({
      provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: "edit", referenceMedia: ONE_VIDEO(6),
    })
    expect(videoRequestAsRun(body, edit)).toStrictEqual({ ...body, aspectRatio: "adaptive", duration: -1 })
    expect(body).toStrictEqual({ provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: "edit" })
  })
})

describe("every model that takes a reference task type has its clips measured before pricing", () => {
  // `edit` needs every reference clip measured. The routes measure them in the
  // reference-video pre-check, which runs before the pricing resolver, but only
  // for a model with a declared clip-length bound; without one, pricing would
  // see the clips unmeasured while the handler (after the guard's own probe)
  // saw them measured, and the two would resolve differently.
  const takers = Object.entries(MODEL_CATALOG)
    .filter(([, entry]) => (entry.referenceTaskTypes?.length ?? 0) > 0)
    .map(([id]) => id)

  it("lists at least one model", () => {
    expect(takers.length).toBeGreaterThan(0)
  })

  for (const id of takers) {
    it(id, () => {
      expect(VIDEO_REF_VIDEO_DURATION_LIMITS[id], `${id} takes a reference task type but has no reference-video length bound`).toBeDefined()
    })
  }
})

describe("every model that takes edit or extend has the length that type runs at", () => {
  // `edit` runs at Auto length, so the model must take one; `extend` runs at a
  // set length, an Auto or missing one becoming the model's default.
  const listing = (type: "edit" | "extend") =>
    Object.entries(MODEL_CATALOG).filter(([, entry]) => entry.referenceTaskTypes?.includes(type)).map(([id]) => id)

  it("lists at least one model for each", () => {
    expect(listing("edit").length).toBeGreaterThan(0)
    expect(listing("extend").length).toBeGreaterThan(0)
  })

  for (const id of listing("edit")) {
    it(`${id} lists edit: it takes Auto length`, () => {
      expect(MODEL_CATALOG[id]!.autoDuration, `${id} lists edit but has no autoDuration`).toBe(true)
    })
  }

  for (const id of listing("extend")) {
    it(`${id} lists extend: it has a default length`, () => {
      expect(MODEL_CATALOG[id]!.defaultDuration, `${id} lists extend but has no defaultDuration`).toEqual(expect.any(Number))
    })
  }
})
