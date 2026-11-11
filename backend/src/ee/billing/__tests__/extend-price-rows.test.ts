// @test-units-by-name names no node unit: it reads only the Seedance extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
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
import { seedanceExtendCreditId } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { seedance2RefVideoBaseCredits } from "../seedance2-ref-video-credits.js"
import { TAIL_RECIPES } from "../../../lib/extend-recipe.js"

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe.each(Object.keys(TAIL_RECIPES) as Array<keyof typeof TAIL_RECIPES>)("%s price rows", (provider) => {
  const recipe = TAIL_RECIPES[provider]
  const entry = MODEL_CATALOG[provider]!
  const durations = entry.durations ?? []
  const resolutions = entry.resolutions ?? []

  it("the catalog offers exactly the recipe's window, at Seedance's three resolutions", () => {
    expect(durations).toEqual(range(recipe.window.min, recipe.window.max))
    expect(resolutions).toEqual(["480p", "720p", "1080p"])
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
        expect(seedanceExtendCreditId(provider, seconds, resolution)).toBe(`${provider}:${seconds}s:${resolution}`)
      }
    }
  })

  it("the catalog leads with its default run's row (8 s, 720p)", () => {
    expect(entry.pricing[0]).toMatchObject({ identifier: `${provider}:8s:720p`, credits: STATIC_CREDIT_COSTS[`${provider}:8s:720p`] })
    for (const row of entry.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
  })
})

describe("the default runs' prices", () => {
  it("Seedance 2.5 and Seedance 2.0, 8 s at 720p", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-5-extend:8s:720p"]).toBe(950)
    expect(STATIC_CREDIT_COSTS["seedance-2-0-extend:8s:720p"]).toBe(625)
  })
})
