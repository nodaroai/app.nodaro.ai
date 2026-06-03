import { describe, it, expect } from "vitest"
import {
  estimateFilmCredits,
  FILM_BASE_CREDITS,
  VIDEO_CLIP_CREDITS,
} from "../film-pricing.js"

describe("estimateFilmCredits", () => {
  it("includes the fixed base for the shortest film", () => {
    const est = estimateFilmCredits(5, "kling-turbo")
    // 5s / 5s clip = 1 shot; perShot = 11 + 2 + 2 = 15; base 45 → 60.
    expect(est.baseCredits).toBe(FILM_BASE_CREDITS)
    expect(est.shotCount).toBe(1)
    expect(est.totalCredits).toBe(60)
    expect(est.modelKnown).toBe(true)
  })

  it("scales shot count with duration / clipSeconds", () => {
    // 60s / 5s = 12 shots; perShot 15 → 180 + 45 = 225.
    const est = estimateFilmCredits(60, "kling-turbo")
    expect(est.shotCount).toBe(12)
    expect(est.totalCredits).toBe(225)
  })

  it("is model-driven — premium models cost far more per second", () => {
    const budget = estimateFilmCredits(60, "veo3_lite")
    const premium = estimateFilmCredits(60, "veo3")
    expect(premium.totalCredits).toBeGreaterThan(budget.totalCredits * 3)
  })

  it("seedance-2 (8s clips, ref) — 30s film", () => {
    // 30 / 8 = ceil 4 shots; perShot = 50 + 2 + 2 = 54; 4*54 = 216 + 45 = 261.
    const est = estimateFilmCredits(30, "seedance-2")
    expect(est.shotCount).toBe(4)
    expect(est.totalCredits).toBe(261)
  })

  it("long film (30 min) on a quality model is thousands of credits", () => {
    const est = estimateFilmCredits(1800, "seedance-2")
    // 1800 / 8 = 225 shots × 54 = 12150 + 45 = 12195.
    expect(est.shotCount).toBe(225)
    expect(est.totalCredits).toBe(12195)
  })

  it("falls back to the default rate when no model is pinned (Auto)", () => {
    const auto = estimateFilmCredits(60)
    const turbo = estimateFilmCredits(60, "kling-turbo")
    expect(auto.modelKnown).toBe(false)
    expect(auto.totalCredits).toBe(turbo.totalCredits) // default = kling-turbo
  })

  it("reports a credits-per-second figure", () => {
    const est = estimateFilmCredits(60, "kling-turbo")
    expect(est.creditsPerSecond).toBeGreaterThan(0)
    expect(est.creditsPerSecond).toBeCloseTo(225 / 60, 1)
  })

  it("every pinnable model in the table has positive cost + clip length", () => {
    for (const [model, c] of Object.entries(VIDEO_CLIP_CREDITS)) {
      expect(c.credits, `${model} credits`).toBeGreaterThan(0)
      expect(c.clipSeconds, `${model} clipSeconds`).toBeGreaterThan(0)
    }
  })
})
