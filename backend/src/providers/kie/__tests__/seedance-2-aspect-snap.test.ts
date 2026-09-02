import { describe, it, expect } from "vitest"
import { applySeedance2Params } from "../video.js"

// The sibling harness `seedance-2-5-frame-aspect.test.ts` passes a plain object
// literal as `options`, so no `as never` cast is needed — read it first and
// match its shape.
const run = (input: Record<string, unknown>, options: Record<string, unknown> = {}, provider = "seedance-2-5") => {
  const payload = { prompt: "a cat", ...input }
  applySeedance2Params(payload, options, provider)
  return payload as Record<string, unknown>
}

describe("applySeedance2Params — aspect ratio", () => {
  it("passes an on-list ratio through untouched", () => {
    expect(run({}, { aspectRatio: "16:9" }).aspect_ratio).toBe("16:9")
    expect(run({}, { aspectRatio: "21:9" }).aspect_ratio).toBe("21:9")
  })

  it("keeps 'adaptive' (it is in the provider enum)", () => {
    expect(run({}, { aspectRatio: "adaptive" }).aspect_ratio).toBe("adaptive")
  })

  it("snaps the off-list ratios the route enums admit", () => {
    expect(run({}, { aspectRatio: "4:5" }).aspect_ratio).toBe("3:4")
    expect(run({}, { aspectRatio: "5:4" }).aspect_ratio).toBe("4:3")
    expect(run({}, { aspectRatio: "9:21" }).aspect_ratio).toBe("9:16")
  })

  it("turns the unified node's 'Auto' into the provider's own match-the-input token when there is an input", () => {
    const out = run({ first_frame_url: "https://f.png" }, { aspectRatio: "Auto" }, "seedance-2")
    expect(out.aspect_ratio).toBe("adaptive")
  })

  it("turns 'Auto' into the fixed default on pure t2v (there is nothing to match)", () => {
    expect(run({}, { aspectRatio: "Auto" }).aspect_ratio).toBe("16:9")
  })

  it("still coerces to adaptive in seedance-2-5 frame mode (existing rule wins last)", () => {
    const out = run({ first_frame_url: "https://f.png" }, { aspectRatio: "4:5" }, "seedance-2-5")
    expect(out.aspect_ratio).toBe("adaptive")
  })

  it("leaves the key absent when the caller sent no ratio", () => {
    expect(run({}, {}).aspect_ratio).toBeUndefined()
  })

  // Aspect ratio is NOT a priced lever for Seedance (resolution and duration
  // are — see credits.ts) — this last-mile snap must change ONLY aspect_ratio,
  // never the fields the credit identifier is built from.
  it("does not touch resolution or duration when snapping an off-list ratio", () => {
    const out = run({ resolution: "1080p", duration: 8 }, { aspectRatio: "9:21", resolution: "1080p" })
    expect(out.aspect_ratio).toBe("9:16")
    expect(out.resolution).toBe("1080p")
    expect(out.duration).toBe(8)
  })

  it("does not touch resolution or duration when resolving Auto", () => {
    const out = run(
      { resolution: "480p", duration: 15 },
      { aspectRatio: "Auto", resolution: "480p" },
      "seedance-2",
    )
    expect(out.aspect_ratio).toBe("16:9")
    expect(out.resolution).toBe("480p")
    expect(out.duration).toBe(15)
  })
})

// §11.3, part (b): 3 t2v rows failed terminally with "The parameters `ratio`
// and `duration` specified in the request are not valid. Seedance identified
// your task as video editing…". The proposed fix was to drop — later, to
// coerce to "adaptive" — the ratio whenever a reference video is attached.
//
// PROBE 2026-09-02 (live bytedance/seedance-2-5, staging key, four cells) —
// the premise is FALSIFIED. Every cell reached state `success`, cell A
// included, and cell A is the exact shape the rewrite was meant to correct:
//
//   A  ref video + aspect_ratio "16:9" + duration 8              -> success
//   B  ref video + duration 8, no aspect_ratio                   -> success
//   C  ref video only                                            -> success
//   D  ref video + ref image + "adaptive" + duration 8 (extend)  -> success
//
// So a reference video does NOT by itself put the run into KIE's video-editing
// task, and a fixed ratio is legal there. What DID classify those 3 rows as
// "video editing" is not the presence of a reference video with a fixed ratio
// or duration — the only axes this probe varied, with one clip and one
// generation-style prompt. Do not re-derive a params rule from the message
// without a probe that reproduces the failure first.
//
// These cases pin today's behaviour so the falsified rewrite cannot come back.
// `duration` matters twice over: deriveKieEgressDimensions
// (egress-dimensions.ts:49-53) and logCreditAudit (video.ts:1581) both read it
// after applySeedance2Params returns.
describe("applySeedance2Params — reference mode with a reference video", () => {
  it("keeps the caller's fixed ratio — a reference video is not KIE's video-editing task (probe cell A)", () => {
    const out = run({ duration: 8 }, { aspectRatio: "16:9", referenceVideoUrls: ["https://v.mp4"] })
    expect(out.aspect_ratio).toBe("16:9")
  })

  it("leaves `duration` alone — deriveKieEgressDimensions and logCreditAudit read it", () => {
    const out = run({ duration: 8 }, { aspectRatio: "16:9", referenceVideoUrls: ["https://v.mp4"] })
    expect(out.duration).toBe(8)
  })

  it("leaves the shape the seedance extend worker already sends untouched (probe cell D)", () => {
    const out = run(
      { duration: 8, first_frame_url: "https://f.png" },
      { aspectRatio: "adaptive", referenceVideoUrls: ["https://v.mp4"] },
    )
    expect(out.aspect_ratio).toBe("adaptive")
    expect(out.duration).toBe(8)
  })

  it("still sends a fixed ratio when only reference IMAGES are attached", () => {
    const out = run({ duration: 8 }, { aspectRatio: "16:9", referenceImageUrls: ["https://i.png"] })
    expect(out.aspect_ratio).toBe("16:9")
    expect(out.duration).toBe(8)
  })

  // Aspect ratio is not a priced lever for seedance — resolution and duration
  // are (credits.ts). Nothing on the reference path may move them.
  it("touches neither resolution nor duration in reference mode", () => {
    const out = run(
      { resolution: "1080p", duration: 8 },
      { aspectRatio: "16:9", resolution: "1080p", referenceVideoUrls: ["https://v.mp4"] },
    )
    expect(out.aspect_ratio).toBe("16:9")
    expect(out.resolution).toBe("1080p")
    expect(out.duration).toBe(8)
  })
})
