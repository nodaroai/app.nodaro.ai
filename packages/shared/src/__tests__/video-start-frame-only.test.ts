import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  GROK_VIDEO_15_PROVIDER,
  grokVideo15MiddleFrameSlots,
  VIDEO_START_FRAME_ONLY_CODE,
  videoStartFrameOnlyMessage,
  videoStartFrameOnlyProblem,
  videoStartFrameOnlyResolution,
} from "../model-constants.js"

const GROK = GROK_VIDEO_15_PROVIDER

const SENTENCE =
  "Grok Imagine Video 1.5 takes a start frame only at 1080p: no end frame, loop or in-between frames. " +
  "Choose 720p, or remove the end frame and the in-between frames."

describe("start-frame-only resolutions are declared in the catalog", () => {
  it("Grok Imagine Video 1.5 takes a start frame only at 1080p", () => {
    expect(MODEL_CATALOG[GROK]!.startFrameOnlyResolutions).toEqual(["1080p"])
  })

  it("every declared tier is one of the model's own resolutions", () => {
    for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
      for (const tier of entry.startFrameOnlyResolutions ?? []) {
        expect(entry.resolutions ?? [], `${id} declares ${tier}`).toContain(tier)
      }
    }
  })

  it("a model that declares none is never refused", () => {
    expect(videoStartFrameOnlyResolution("kling-4-keyframes", "1080p")).toBeUndefined()
    expect(videoStartFrameOnlyProblem("kling-4-keyframes", { resolution: "1080p", hasEndFrame: true, inBetweenFrameCount: 3 })).toBeUndefined()
    expect(videoStartFrameOnlyProblem(undefined, { resolution: "1080p", hasEndFrame: true, inBetweenFrameCount: 3 })).toBeUndefined()
  })

  it("reads the resolution case-folded, as the runner sends it", () => {
    expect(videoStartFrameOnlyResolution(GROK, "1080P")).toBe("1080p")
    expect(videoStartFrameOnlyResolution(GROK, " 1080p ")).toBe("1080p")
    expect(videoStartFrameOnlyResolution(GROK, "720p")).toBeUndefined()
    expect(videoStartFrameOnlyResolution(GROK, undefined)).toBeUndefined()
  })
})

describe("videoStartFrameOnlyProblem — every combination at 480p, 720p and 1080p", () => {
  const RESOLUTIONS = ["480p", "720p", "1080p"] as const
  const DURATIONS = Array.from({ length: 15 }, (_, i) => i + 1)

  for (const resolution of RESOLUTIONS) {
    for (const hasEndFrame of [false, true]) {
      for (let wired = 0; wired <= 6; wired++) {
        it(`${resolution}, end frame ${hasEndFrame ? "(or loop) " : "none, "}${wired} in-between frame(s) wired, 1–15s`, () => {
          for (const durationSec of DURATIONS) {
            const sent = Math.min(wired, grokVideo15MiddleFrameSlots(durationSec))
            const refused = resolution === "1080p" && (hasEndFrame || sent > 0)
            const problem = videoStartFrameOnlyProblem(GROK, { resolution, durationSec, hasEndFrame, inBetweenFrameCount: wired })
            expect(problem !== undefined, `${durationSec}s`).toBe(refused)
            if (problem) {
              expect(problem.code).toBe(VIDEO_START_FRAME_ONLY_CODE)
              expect(problem.message).toBe(SENTENCE)
            }
          }
        })
      }
    }
  }

  it("a start frame alone runs at 1080p", () => {
    expect(videoStartFrameOnlyProblem(GROK, { resolution: "1080p", durationSec: 8, hasEndFrame: false, inBetweenFrameCount: 0 })).toBeUndefined()
  })

  it("in-between frames all dropped by the clip's cap leave a start-only run, which runs at 1080p", () => {
    // A 1-second clip has no whole second inside it: every in-between frame is dropped.
    expect(grokVideo15MiddleFrameSlots(1)).toBe(0)
    expect(videoStartFrameOnlyProblem(GROK, { resolution: "1080p", durationSec: 1, hasEndFrame: false, inBetweenFrameCount: 4 })).toBeUndefined()
    // ...but an end frame beside it is still sent, so that run is refused.
    expect(videoStartFrameOnlyProblem(GROK, { resolution: "1080p", durationSec: 1, hasEndFrame: true, inBetweenFrameCount: 4 })).toBeDefined()
    // A 2-second clip keeps one of them, so it is refused.
    expect(videoStartFrameOnlyProblem(GROK, { resolution: "1080p", durationSec: 2, hasEndFrame: false, inBetweenFrameCount: 4 })).toBeDefined()
  })

  it("an unset duration is judged at the length the run renders (the 8s default)", () => {
    expect(videoStartFrameOnlyProblem(GROK, { resolution: "1080p", hasEndFrame: false, inBetweenFrameCount: 1 })).toBeDefined()
  })
})

describe("the refusal sentence", () => {
  it("says the tier takes a start frame only, and offers 720p or removing the frames", () => {
    expect(videoStartFrameOnlyMessage(GROK, "1080p")).toBe(SENTENCE)
  })

  it("says nothing was charged only for a refused run", () => {
    expect(videoStartFrameOnlyMessage(GROK, "1080p", { nothingCharged: true })).toBe(`${SENTENCE} Nothing was charged.`)
    expect(
      videoStartFrameOnlyProblem(GROK, { resolution: "1080p", hasEndFrame: true, inBetweenFrameCount: 0, nothingCharged: true })!.message,
    ).toBe(`${SENTENCE} Nothing was charged.`)
  })
})
