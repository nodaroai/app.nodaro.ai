import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC } from "@nodaro/shared/models"
import { extendSourceTooShortMessage, isTailRecipeProvider, tailRecipeSeconds, TAIL_RECIPES } from "../extend-recipe.js"

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

  it("a missing prompt in untyped job data never throws", () => {
    expect(TAIL_RECIPES["seedance-2-5-extend"].prompt(undefined)).toBe("extend @video_1 as follows:\n")
    expect(TAIL_RECIPES["seedance-2-0-extend"].prompt(null)).toBe("extend @video_1 as follows:\n")
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
  })

  // The shortest source a run can continue is the shortest reference Seedance
  // takes (KIE refuses a shorter r2v clip), not the 2 s tail the run asks for:
  // a 1.97 s clip sends all it has. One value for the route and the worker.
  it.each(Object.keys(TAIL_RECIPES) as (keyof typeof TAIL_RECIPES)[])(
    "the source floor is Seedance's minimum reference length (%s)",
    (provider) => {
      expect(TAIL_RECIPES[provider].minSourceSec).toBe(SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC)
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
    expect(isTailRecipeProvider("seedance-2-extend")).toBe(false)
    expect(isTailRecipeProvider("veo-extend")).toBe(false)
    expect(isTailRecipeProvider("toString")).toBe(false)
  })
})
