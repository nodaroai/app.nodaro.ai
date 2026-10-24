/**
 * Cast Swap's input limits and a trend's prompt limits: the server enforces
 * them and the admin screen holds Save on them, both from here. Pinned, so a
 * change is a decision (the engine's own schema has to move with it).
 */
import { describe, expect, it } from "vitest"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  CAST_SWAP_ENGINES,
  CAST_SWAP_POST_PROMPT_MAX,
  CAST_SWAP_RESOLUTIONS_BY_ENGINE,
  TREND_PROMPT_LIMITS,
  castSwapEngineHasDraft,
  CAST_SWAP_KLING_LENGTHS,
  CAST_SWAP_KLING_LENGTH_WHEN_OMITTED,
  CAST_SWAP_KLING_MAX_IMAGES,
} from "../cast-swap-limits.js"

describe("Cast Swap limits", () => {
  it("pins the post prompt cap and a trend's prompt limits", () => {
    expect(CAST_SWAP_POST_PROMPT_MAX).toBe(4000)
    expect(TREND_PROMPT_LIMITS).toEqual({ trendPromptMax: 3000, prePromptMax: 3000, detailsMax: 1000, engineTextReserve: 17_000 })
  })

  it("leaves a new trend prompt 2998 characters: the post prompt less the details and the blank line", () => {
    expect(CAST_SWAP_POST_PROMPT_MAX - 2 - TREND_PROMPT_LIMITS.detailsMax).toBe(2998)
  })

  it("pins the face masking bounds, and every default sits inside them", () => {
    expect(CAST_SWAP_FACE_MASKING_BOUNDS).toEqual({
      faceHeightPct: [0, 100],
      zonePct: [0, 49],
      blurStrengthPct: [0.1, 5],
      threshold: [0.05, 0.95],
    })
    const inside = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi
    const b = CAST_SWAP_FACE_MASKING_BOUNDS
    const d = CAST_SWAP_FACE_MASKING_DEFAULTS
    expect(inside(d.minFaceHeightPct, b.faceHeightPct)).toBe(true)
    expect(inside(d.maxFaceHeightPct, b.faceHeightPct)).toBe(true)
    expect(inside(d.zonePct, b.zonePct)).toBe(true)
    for (const side of ["leftPct", "rightPct", "topPct", "bottomPct"] as const) expect(inside(d.zone[side], b.zonePct), side).toBe(true)
    expect(inside(d.blurStrengthPct, b.blurStrengthPct)).toBe(true)
    expect(inside(d.threshold, b.threshold)).toBe(true)
  })

  it("covers a masked face with a blur by default", () => {
    expect(CAST_SWAP_FACE_MASKING_DEFAULTS.fill).toBe("blur")
  })

  it("leaves 10 % margins at the left and right when the zone is left out", () => {
    expect(CAST_SWAP_FACE_MASKING_DEFAULTS.zone).toEqual({ leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 })
  })

  it("runs on Seedance 2.5 or Kling 4, Seedance when no engine is named", () => {
    expect(CAST_SWAP_ENGINES).toEqual(["seedance-2-5", "kling-4"])
    expect(CAST_SWAP_ENGINE_WHEN_OMITTED).toBe("seedance-2-5")
  })

  it("offers Kling 4 720p and 1080p with no draft, and Seedance 2.5 its 480p draft first", () => {
    expect(CAST_SWAP_RESOLUTIONS_BY_ENGINE).toEqual({ "seedance-2-5": ["480p", "720p", "1080p"], "kling-4": ["720p", "1080p"] })
    expect(castSwapEngineHasDraft("seedance-2-5")).toBe(true)
    expect(castSwapEngineHasDraft("kling-4")).toBe(false)
  })

  it("fits a Kling 4 run's length by cutting the end, unless a trend or run says otherwise", () => {
    expect(CAST_SWAP_KLING_LENGTHS).toEqual(["cut-end", "cut-start"])
    expect(CAST_SWAP_KLING_LENGTH_WHEN_OMITTED).toBe("cut-end")
  })

  it("caps a Kling 4 run at 10 images", () => {
    expect(CAST_SWAP_KLING_MAX_IMAGES).toBe(10)
  })
})
