import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { EXTEND_VIDEO_PROVIDERS, SEEDANCE_2_EXTEND_STITCH, SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC, VIDEO_REF_VIDEO_DURATION_LIMITS, applyVideoNegativePrompt, getMaxVideoPromptChars, isTailExtendProvider } from "@nodaro/shared/models"
import {
  extendSourceTooShortMessage,
  extensionTooShort,
  extensionTooShortMessage,
  isTailRecipeProvider,
  tailCutSec,
  tailRecipeSeconds,
  TAIL_RECIPES,
} from "../extend-recipe.js"
import { buildKling4Request } from "../../providers/kie/kling4.js"

// The tail recipe is what a tail-recipe Extend Video run does: the window it
// snaps the seconds into is a second copy of the provider's catalog
// `durations` (which the editor offers and the price rows cover), so the two
// are held equal here.

describe("TAIL_RECIPES", () => {
  it.each(Object.keys(TAIL_RECIPES) as (keyof typeof TAIL_RECIPES)[])(
    "each recipe's window equals its catalog durations (%s)",
    (provider) => {
      const durations = MODEL_CATALOG[provider]?.durations
      expect(durations?.length).toBeGreaterThan(0)
      expect(TAIL_RECIPES[provider].window).toEqual({ min: Math.min(...durations!), max: Math.max(...durations!) })
    },
  )

  // Seedance 2.5 (decided 2026-11-12): the provider guide's extension trigger,
  // naming the seconds added. Seedance 2.0 keeps the 2026-07-12 spike's template.
  it("prompts Seedance 2.5 with the guide's extension trigger, and 2.0 with its template", () => {
    expect(TAIL_RECIPES["seedance-2-5-extend"].prompt("x", 8)).toBe("Extend @video_1 forward by 8 seconds: x")
    expect(TAIL_RECIPES["seedance-2-5-extend"].prompt("  x  ", 25)).toBe("Extend @video_1 forward by 25 seconds: x")
    expect(TAIL_RECIPES["seedance-2-0-extend"].prompt("  x  ", 8)).toBe("extend @video_1 as follows:\nx")
  })

  it('the Kling prompt is "Continue @video_1 as one continuous shot, starting exactly where it ends: <prompt>"', () => {
    expect(TAIL_RECIPES["kling-4-extend"].prompt("she opens the door", 5)).toBe(
      "Continue @video_1 as one continuous shot, starting exactly where it ends: she opens the door",
    )
    expect(TAIL_RECIPES["kling-4-extend"].prompt("  x  ", 5)).toBe("Continue @video_1 as one continuous shot, starting exactly where it ends: x")
  })

  it("a missing prompt in untyped job data never throws", () => {
    expect(TAIL_RECIPES["seedance-2-5-extend"].prompt(undefined, 8)).toBe("Extend @video_1 forward by 8 seconds: ")
    expect(TAIL_RECIPES["seedance-2-0-extend"].prompt(null, 8)).toBe("extend @video_1 as follows:\n")
    expect(TAIL_RECIPES["kling-4-extend"].prompt(undefined, 5)).toBe("Continue @video_1 as one continuous shot, starting exactly where it ends: ")
  })

  // Seedance 2.5 runs the provider guide's recipe: the source's last 10 s,
  // declared as an extension, no start image — so nothing at the join is a
  // duplicate, and the stitch neither searches nor trims (a hard cut, the
  // sound crossfaded). Seedance 2.0 is exactly what it was.
  it("Seedance 2.5: the last 10 s, declared as an extension, no start image, a hard cut", () => {
    const r = TAIL_RECIPES["seedance-2-5-extend"]
    expect(r.tailSec).toBe(10)
    expect(r.startImage).toBe(false)
    expect(r.referenceTaskType).toBe("extend")
    expect(r.stitch).toEqual({ fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 }, audioFadeSec: 0.15 })
  })

  it("Seedance 2.0: the last 2 s, the last frame as the start image, undeclared, the smart stitch", () => {
    const r = TAIL_RECIPES["seedance-2-0-extend"]
    expect(r.tailSec).toBe(2)
    expect(r.startImage).toBe(true)
    expect(r.referenceTaskType).toBeUndefined()
    expect(r.stitch).toEqual({
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      fallbackTrims: { trimEndFrames: SEEDANCE_2_EXTEND_STITCH.trimTailFrames, trimStartFrames: SEEDANCE_2_EXTEND_STITCH.trimHeadFrames },
      audioFadeSec: SEEDANCE_2_EXTEND_STITCH.audioFadeSec,
    })
    expect(r.stitch.fallbackTrims).toEqual({ trimEndFrames: 4, trimStartFrames: 3 })
  })

  it("Kling 4 generates on Kling 4.0", () => {
    expect(TAIL_RECIPES["kling-4-extend"].genModel).toBe("kling-4")
  })

  // The seconds a run adds, read once for the route (what it queues), the
  // worker (what it generates) and the output-length rule (what it records);
  // each of those is held to this function in its own test.
  it("tailRecipeSeconds: the catalog default when unset, rounded, held in the window", () => {
    expect(tailRecipeSeconds("seedance-2-5-extend", undefined)).toBe(8)
    expect(tailRecipeSeconds("seedance-2-0-extend", undefined)).toBe(8)
    expect(tailRecipeSeconds("seedance-2-5-extend", 25)).toBe(25)
    expect(tailRecipeSeconds("seedance-2-0-extend", 25)).toBe(15)
    expect(tailRecipeSeconds("seedance-2-5-extend", 45)).toBe(30)
    expect(tailRecipeSeconds("seedance-2-5-extend", 2)).toBe(4)
    expect(tailRecipeSeconds("seedance-2-0-extend", 12.4)).toBe(12)
    expect(tailRecipeSeconds("seedance-2-0-extend", "12")).toBe(12)
    expect(tailRecipeSeconds("seedance-2-5-extend", "not a number")).toBe(8)
    expect(tailRecipeSeconds("seedance-2-5-extend", null)).toBe(8)
    expect(tailRecipeSeconds("seedance-2-5-extend", {})).toBe(8)
    // Kling 4: its own 5 s default and 3–30 s window.
    expect(tailRecipeSeconds("kling-4-extend", undefined)).toBe(5)
    expect(tailRecipeSeconds("kling-4-extend", 2)).toBe(3)
    expect(tailRecipeSeconds("kling-4-extend", 3)).toBe(3)
    expect(tailRecipeSeconds("kling-4-extend", 22)).toBe(22)
    expect(tailRecipeSeconds("kling-4-extend", 45)).toBe(30)
  })

  // The shortest source a Seedance run can continue is the shortest reference
  // Seedance takes (KIE refuses a shorter r2v clip), not the 2 s tail the run
  // asks for: a 1.97 s clip sends all it has. One value for the route and the worker.
  it.each(["seedance-2-5-extend", "seedance-2-0-extend"] as const)(
    "the source floor is Seedance's minimum reference length (%s)",
    (provider) => {
      expect(TAIL_RECIPES[provider].minSourceSec).toBe(SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC)
    },
  )

  // Kling 4 sends a 3 s tail, and continues any source down to the shortest
  // reference it takes (2 s): a shorter source sends all its picture.
  it("Kling 4 sends a 3 s tail and continues a source down to Kling's 2 s reference floor", () => {
    expect(TAIL_RECIPES["kling-4-extend"].tailSec).toBe(3)
    expect(TAIL_RECIPES["kling-4-extend"].minSourceSec).toBe(2)
    expect(TAIL_RECIPES["kling-4-extend"].minSourceSec).toBe(VIDEO_REF_VIDEO_DURATION_LIMITS["kling-4"]!.minSec)
  })

  // The tail a run cuts: the recipe's tail, or the whole picture when the
  // source has less (a source at or above the floor, the only one that runs).
  it("tailCutSec: the recipe's tail, or all of a shorter picture", () => {
    expect(tailCutSec("kling-4-extend", 10)).toBe(3)
    expect(tailCutSec("kling-4-extend", 3)).toBe(3)
    expect(tailCutSec("kling-4-extend", 2.5)).toBe(2.5)
    expect(tailCutSec("kling-4-extend", 2)).toBe(2)
    // Seedance 2.5 sends the source's last 10 s: a 6 s picture is sent whole.
    expect(tailCutSec("seedance-2-5-extend", 6)).toBe(6)
    expect(tailCutSec("seedance-2-5-extend", 25)).toBe(10)
    expect(tailCutSec("seedance-2-0-extend", 1.97)).toBe(1.97)
  })

  it.each(Object.keys(TAIL_RECIPES) as (keyof typeof TAIL_RECIPES)[])(
    "a source at the floor is never longer than the tail it sends (%s)",
    (provider) => {
      expect(TAIL_RECIPES[provider].minSourceSec).toBeLessThanOrEqual(TAIL_RECIPES[provider].tailSec)
    },
  )

  it("names the provider and its floor when a source is too short", () => {
    expect(extendSourceTooShortMessage("seedance-2-0-extend", 1.2)).toBe(
      "Source video is too short to extend: Seedance 2.0 Extend needs at least 1.8s of footage to continue from (got 1.20s).",
    )
  })

  it("isTailRecipeProvider answers for its own keys only", () => {
    expect(isTailRecipeProvider("seedance-2-5-extend")).toBe(true)
    expect(isTailRecipeProvider("seedance-2-0-extend")).toBe(true)
    expect(isTailRecipeProvider("kling-4-extend")).toBe(true)
    expect(isTailRecipeProvider("kling-4")).toBe(false)
    expect(isTailRecipeProvider("seedance-2-extend")).toBe(false)
    expect(isTailRecipeProvider("veo-extend")).toBe(false)
    expect(isTailRecipeProvider("toString")).toBe(false)
  })

  it("has a recipe for exactly the tail-recipe providers the shared list names", () => {
    expect(Object.keys(TAIL_RECIPES)).toEqual(EXTEND_VIDEO_PROVIDERS.filter(isTailExtendProvider))
  })
})

// An extension whose picture is shorter than half the seconds the run is
// billed for fails the run with a full refund: neither the source alone nor
// the source with the short extension is delivered.
describe("extensionTooShort", () => {
  it("is short below half the billed seconds; exactly half and above are not", () => {
    expect(extensionTooShort(2, 5)).toBe(true)
    expect(extensionTooShort(2.49, 5)).toBe(true)
    expect(extensionTooShort(3.99, 8)).toBe(true)
    expect(extensionTooShort(2.5, 5)).toBe(false)
    expect(extensionTooShort(4, 8)).toBe(false)
    expect(extensionTooShort(1.5, 3)).toBe(false)
    expect(extensionTooShort(5, 5)).toBe(false)
    expect(extensionTooShort(8.2, 5)).toBe(false)
  })

  it("is short when there is no picture: none, zero, or a length that does not read", () => {
    expect(extensionTooShort(undefined, 5)).toBe(true)
    expect(extensionTooShort(0, 5)).toBe(true)
    expect(extensionTooShort(Number.NaN, 5)).toBe(true)
  })

  it("says what the model returned against what the run is billed for, and that nothing was charged", () => {
    expect(extensionTooShortMessage(2, 5)).toBe(
      "The model returned only 2.0s of the 5s extension, so nothing was charged. Try again.",
    )
    // Rounded down, so a refused length never reads as the half that passes.
    expect(extensionTooShortMessage(2.46, 5)).toBe(
      "The model returned only 2.4s of the 5s extension, so nothing was charged. Try again.",
    )
    expect(extensionTooShortMessage(undefined, 8)).toBe(
      "The model returned only 0.0s of the 8s extension, so nothing was charged. Try again.",
    )
  })
})

// A Kling 4 Extend prompt reaches Kling 4.0 wrapped: the recipe's wrapper
// before the user's prompt, and the opening-frame sentence the reference
// endpoint adds after it. The cap the route and the editor hold the user's
// prompt to (`getMaxVideoPromptChars("kling-4-extend")`) leaves exactly that
// room in Kling 4.0's own, so a prompt at the cap — its "Avoid: …" clause
// last — reaches Kling whole.
describe("the Kling 4 Extend prompt cap", () => {
  const FRAME = "https://cdn.example.com/extend-last-frame.png"
  const TAIL = "https://cdn.example.com/extend-tail.mp4"
  const sentToKling = (userPrompt: string): string =>
    String(buildKling4Request({
      provider: "kling-4",
      prompt: TAIL_RECIPES["kling-4-extend"].prompt(userPrompt, 5),
      durationSec: 5,
      startFrameUrl: FRAME,
      referenceVideoUrls: [TAIL],
    }).input.prompt)

  it("leaves Kling 4.0's limit exactly the room the wrapper and the opening-frame sentence take", () => {
    const overhead = sentToKling("").length
    expect(overhead).toBeGreaterThan(0)
    expect(getMaxVideoPromptChars("kling-4-extend") + overhead).toBe(getMaxVideoPromptChars("kling-4"))
  })

  it("a prompt at the cap reaches Kling whole, its Avoid clause included, within Kling 4.0's limit", () => {
    const { prompt } = applyVideoNegativePrompt("a".repeat(20_000), "blurry faces", "kling-4-extend")
    expect(prompt!.length).toBe(getMaxVideoPromptChars("kling-4-extend"))
    const sent = sentToKling(prompt!)
    expect(sent.length).toBeLessThanOrEqual(getMaxVideoPromptChars("kling-4"))
    expect(sent).toContain("Avoid: blurry faces")
    expect(sent.endsWith("Use @image_1 as the opening (first) frame of the video.")).toBe(true)
  })
})
