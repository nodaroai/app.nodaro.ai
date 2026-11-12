import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { EXTEND_VIDEO_PROVIDERS, SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC, VIDEO_REF_VIDEO_DURATION_LIMITS, applyVideoNegativePrompt, getMaxVideoPromptChars, isTailExtendProvider } from "@nodaro/shared/models"
import { extendSourceTooShortMessage, isTailRecipeProvider, tailCutSec, tailRecipeSeconds, TAIL_RECIPES } from "../extend-recipe.js"
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

  it("prompts Seedance with the extend template", () => {
    expect(TAIL_RECIPES["seedance-2-5-extend"].prompt("x")).toBe("extend @video_1 as follows:\nx")
    expect(TAIL_RECIPES["seedance-2-0-extend"].prompt("  x  ")).toBe("extend @video_1 as follows:\nx")
  })

  it('the Kling prompt is "Continue @video_1 as one continuous shot, starting exactly where it ends: <prompt>"', () => {
    expect(TAIL_RECIPES["kling-4-extend"].prompt("she opens the door")).toBe(
      "Continue @video_1 as one continuous shot, starting exactly where it ends: she opens the door",
    )
    expect(TAIL_RECIPES["kling-4-extend"].prompt("  x  ")).toBe("Continue @video_1 as one continuous shot, starting exactly where it ends: x")
  })

  it("a missing prompt in untyped job data never throws", () => {
    expect(TAIL_RECIPES["seedance-2-5-extend"].prompt(undefined)).toBe("extend @video_1 as follows:\n")
    expect(TAIL_RECIPES["seedance-2-0-extend"].prompt(null)).toBe("extend @video_1 as follows:\n")
    expect(TAIL_RECIPES["kling-4-extend"].prompt(undefined)).toBe("Continue @video_1 as one continuous shot, starting exactly where it ends: ")
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
    expect(tailCutSec("seedance-2-5-extend", 6)).toBe(2)
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
      prompt: TAIL_RECIPES["kling-4-extend"].prompt(userPrompt),
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
