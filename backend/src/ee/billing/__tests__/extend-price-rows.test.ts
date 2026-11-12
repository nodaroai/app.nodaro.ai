// @test-units-by-name names no node unit: it reads only the tail-recipe extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
/**
 * An Extend Video price row holds what the run bills. A tail-recipe extend
 * sends the source's last seconds as a reference clip, and the provider bills
 * that clip's seconds beside the seconds it adds — so each row equals the
 * reference-video price of exactly that run, and repricing the reference rows
 * fails here until the extend rows follow.
 *
 * The lengths and resolutions each provider is held to are its catalog entry's
 * (`MODEL_CATALOG[provider].durations` / `.resolutions`): what its picker,
 * route and MCP tool offer.
 */
import { describe, expect, it } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { tailExtendCreditId } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { seedance2RefVideoBaseCredits } from "../seedance2-ref-video-credits.js"
import { TAIL_RECIPES } from "../../../lib/extend-recipe.js"

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe.each(Object.keys(TAIL_RECIPES) as Array<keyof typeof TAIL_RECIPES>)("%s price rows", (provider) => {
  const recipe = TAIL_RECIPES[provider]
  const entry = MODEL_CATALOG[provider]!
  const durations = entry.durations ?? []
  const resolutions = entry.resolutions ?? []

  it("the catalog offers exactly the recipe's window, at one or more resolutions", () => {
    expect(durations).toEqual(range(recipe.window.min, recipe.window.max))
    expect(resolutions.length).toBeGreaterThan(0)
  })

  it("every row equals billed seconds (the seconds added plus the reference clip)", () => {
    for (const seconds of durations) {
      for (const resolution of resolutions) {
        const id = `${provider}:${seconds}s:${resolution}`
        const billed = seedance2RefVideoBaseCredits({
          provider: recipe.genModel,
          resolution,
          outputDurationSec: seconds,
          inputVideoDurationSec: recipe.tailSec,
        })
        expect(STATIC_CREDIT_COSTS[id], id).toBe(billed)
      }
    }
  })

  it("has a row for every second of the window and none outside it", () => {
    const expected = durations.flatMap((seconds) => resolutions.map((resolution) => `${provider}:${seconds}s:${resolution}`))
    const actual = Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith(`${provider}:`))
    expect(actual.sort()).toEqual(expected.sort())
  })

  it("is the row a run of every length and resolution is priced at", () => {
    for (const seconds of durations) {
      for (const resolution of resolutions) {
        expect(tailExtendCreditId(provider, seconds, resolution)).toBe(`${provider}:${seconds}s:${resolution}`)
      }
    }
  })

  it("the catalog leads with its default run's row (its default length, 720p)", () => {
    const defaultRow = `${provider}:${entry.defaultDuration}s:720p`
    expect(tailExtendCreditId(provider)).toBe(defaultRow)
    expect(entry.pricing[0]).toMatchObject({ identifier: defaultRow, credits: STATIC_CREDIT_COSTS[defaultRow] })
    for (const row of entry.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
  })
})

describe("each provider's lengths and resolutions", () => {
  it("Seedance renders 480p, 720p and 1080p; Kling 4 renders 720p and 1080p", () => {
    expect(MODEL_CATALOG["seedance-2-5-extend"]!.resolutions).toEqual(["480p", "720p", "1080p"])
    expect(MODEL_CATALOG["seedance-2-0-extend"]!.resolutions).toEqual(["480p", "720p", "1080p"])
    expect(MODEL_CATALOG["kling-4-extend"]!.resolutions).toEqual(["720p", "1080p"])
  })
})

describe("the default runs' prices", () => {
  it("Seedance 2.5 and Seedance 2.0, 8 s at 720p", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-5-extend:8s:720p"]).toBe(950)
    expect(STATIC_CREDIT_COSTS["seedance-2-0-extend:8s:720p"]).toBe(625)
  })

  // Kling 4 bills its output plus the longer of its output and its reference
  // (the 3 s tail, never longer than the 3 s or more it adds): twice the
  // seconds added at its reference-video rate.
  it("every kling-4-extend row equals billed seconds (spot: kling-4-extend:5s:720p)", () => {
    expect(STATIC_CREDIT_COSTS["kling-4-extend:5s:720p"]).toBe(425)
    expect(STATIC_CREDIT_COSTS["kling-4-extend:5s:720p"]).toBe(
      seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "720p", outputDurationSec: 5, inputVideoDurationSec: 3 }),
    )
    for (const seconds of range(3, 30)) {
      for (const resolution of ["720p", "1080p"]) {
        expect(STATIC_CREDIT_COSTS[`kling-4-extend:${seconds}s:${resolution}`], `${seconds}s ${resolution}`).toBe(
          seedance2RefVideoBaseCredits({ provider: "kling-4", resolution, outputDurationSec: seconds, inputVideoDurationSec: 3 }),
        )
      }
    }
  })
})
