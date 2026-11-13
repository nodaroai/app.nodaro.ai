// @test-units-by-name names no node unit: it reads only the tail-recipe extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
/**
 * An Extend Video price row holds what the run bills. A tail-recipe extend
 * sends the source's last seconds as a reference clip, and the provider bills
 * that clip's seconds beside the seconds it adds — so each row equals the
 * reference-video price of exactly that run, and repricing the reference rows
 * fails here until the extend rows follow.
 *
 * - Seedance 2.0 sends a 2-second tail, and Kling 4 a 3-second one: one row per
 *   second added × resolution.
 * - Seedance 2.5 sends the source's last 10 s (all of a shorter source),
 *   decided 2026-11-12: it is charged per second sent and added, each
 *   resolution's row the price of two seconds (@nodaro/render-rules
 *   `seedance-extend-pricing.ts`). No run is priced on its earlier per-length
 *   rows; a client built on an earlier `@nodaro/shared` still names them, so
 *   each is the most a run of its length costs (the whole 10 s window sent,
 *   decided 2026-11-13), and the shared builder names that whole-run quote.
 *
 * The lengths and resolutions each provider is held to are its catalog entry's
 * (`MODEL_CATALOG[provider].durations` / `.resolutions`): what its picker,
 * route and MCP tool offer.
 */
import { describe, expect, it } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { buildVideoCreditModelIdentifier, tailExtendCreditId, unitQuoteCreditId } from "@nodaro/shared/credits"
import {
  SEEDANCE_EXTEND_CONTEXT_MAX_SEC,
  SEEDANCE_EXTEND_RATE_CREDIT_IDS,
  SEEDANCE_EXTEND_RATE_SECONDS,
  seedanceExtendPrice,
  seedanceExtendRateCreditId,
} from "@nodaro/render-rules"
import { STATIC_CREDIT_COSTS, chargedCredits, chargedPriceTableFrom } from "../credits.js"
import { seedance2RefVideoBaseCredits } from "../seedance2-ref-video-credits.js"
import { applyMarkupPercent } from "../service-margin.js"
import { quoteBaseCredits } from "../../../lib/credit-base-cost.js"
import { parseRateQuoteCreditId } from "../../../lib/unit-quote-rates.js"
import { TAIL_RECIPES } from "../../../lib/extend-recipe.js"

/** A sweep of tens of thousands of cases: well under a second alone, longer on a loaded CI worker. */
const SWEEP_TIMEOUT_MS = 60_000

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const RESOLUTIONS = ["480p", "720p", "1080p"] as const

/** The BASE credits a Seedance 2.5 extend is charged, read the way every lane reads it: the rate row × the units, rounded up once. */
const base25 = (args: { duration: unknown; resolution: unknown; sourcePictureSec: number | undefined }): number => {
  const price = seedanceExtendPrice(args)
  return quoteBaseCredits(STATIC_CREDIT_COSTS[price.rateId]!, price.units)
}

describe.each(Object.keys(TAIL_RECIPES) as Array<keyof typeof TAIL_RECIPES>)("%s: the catalog", (provider) => {
  const recipe = TAIL_RECIPES[provider]
  const entry = MODEL_CATALOG[provider]!

  it("the catalog offers exactly the recipe's window, at one or more resolutions", () => {
    expect(entry.durations ?? []).toEqual(range(recipe.window.min, recipe.window.max))
    expect((entry.resolutions ?? []).length).toBeGreaterThan(0)
  })

  it("every catalog price row is priced at its own figure (a static row, or a whole run of one)", () => {
    for (const row of entry.pricing) {
      const quote = parseRateQuoteCreditId(row.identifier)
      const figure = quote ? quoteBaseCredits(STATIC_CREDIT_COSTS[quote.rateId]!, quote.units) : STATIC_CREDIT_COSTS[row.identifier]
      expect(figure, row.identifier).toBe(row.credits)
    }
  })
})

// The providers priced on one row per second added × resolution (a fixed tail).
describe.each(["seedance-2-0-extend", "kling-4-extend"] as const)("%s price rows", (provider) => {
  const recipe = TAIL_RECIPES[provider]
  const entry = MODEL_CATALOG[provider]!
  const durations = entry.durations ?? []
  const resolutions = entry.resolutions ?? []

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
  it("Seedance 2.0, 8 s at 720p (and the earlier Seedance 2.5 row: the most an 8 s run at 720p costs)", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-5-extend:8s:720p"]).toBe(1710)
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

describe("seedance-2-5-extend: charged per second sent and added", () => {
  const provider = "seedance-2-5-extend" as const
  const entry = MODEL_CATALOG[provider]!
  const durations = entry.durations ?? []

  it("each resolution's row is two seconds at the seedance-2-5 reference-video rate (its 8 s -ref row ÷ 8)", () => {
    expect(SEEDANCE_EXTEND_RATE_SECONDS).toBe(2)
    for (const resolution of RESOLUTIONS) {
      const perSecond = STATIC_CREDIT_COSTS[`seedance-2-5:8s:${resolution}-ref`]! / 8
      expect(STATIC_CREDIT_COSTS[SEEDANCE_EXTEND_RATE_CREDIT_IDS[resolution]], resolution).toBe(perSecond * SEEDANCE_EXTEND_RATE_SECONDS)
    }
    expect(SEEDANCE_EXTEND_RATE_CREDIT_IDS).toEqual({
      "480p": "seedance-2-5-extend:480p:per-2s",
      "720p": "seedance-2-5-extend:720p:per-2s",
      "1080p": "seedance-2-5-extend:1080p:per-2s",
    })
    expect([85, 190, 475]).toEqual(RESOLUTIONS.map((r) => STATIC_CREDIT_COSTS[SEEDANCE_EXTEND_RATE_CREDIT_IDS[r]]))
  })

  it("the run's rate row is its resolution's (one the model offers, else 720p)", () => {
    expect(seedanceExtendRateCreditId("480p")).toBe("seedance-2-5-extend:480p:per-2s")
    expect(seedanceExtendRateCreditId("1080p")).toBe("seedance-2-5-extend:1080p:per-2s")
    for (const other of [undefined, "720p", "4k", "2160p", 7]) expect(seedanceExtendRateCreditId(other)).toBe("seedance-2-5-extend:720p:per-2s")
  })

  // Decided 2026-11-13: a client built on an earlier @nodaro/shared still
  // quotes a run by its earlier per-length row, so each row is the most a run
  // of its length can cost — the whole 10 s window sent — and the shared
  // builder names exactly that whole-run quote.
  it("each of the 81 earlier per-length rows is the base of the whole-window run of its length", () => {
    let checked = 0
    for (const seconds of durations) {
      for (const resolution of RESOLUTIONS) {
        const earlier = STATIC_CREDIT_COSTS[`${provider}:${seconds}s:${resolution}`]
        expect(earlier, `${seconds}s ${resolution}`).toBe(base25({ duration: seconds, resolution, sourcePictureSec: undefined }))
        expect(earlier, `${seconds}s ${resolution}`).toBe(quoteBaseCredits(STATIC_CREDIT_COSTS[SEEDANCE_EXTEND_RATE_CREDIT_IDS[resolution]]!, (SEEDANCE_EXTEND_CONTEXT_MAX_SEC + seconds) / 2))
        checked++
      }
    }
    expect(checked).toBe(81)
  })

  // Priced the way the price lookups price both ids — the charged price table,
  // each marked up at its own margin key — with a per-service margin on the
  // model's prefix beside the global markup: the earlier row charges what the
  // whole-window quote charges, and never less than a run of that length.
  it("an earlier row is charged what its whole-window quote is, and never below a run of its length", () => {
    const table = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10, service_margin_percent: { "seedance-2-5-extend": 25 } })
    let cases = 0
    for (const seconds of durations) {
      for (const resolution of RESOLUTIONS) {
        const earlierId = `${provider}:${seconds}s:${resolution}`
        const quoteId = tailExtendCreditId(provider, seconds, resolution)
        const earlier = chargedCredits(table, earlierId)
        expect(earlier, earlierId).toBeDefined()
        expect(earlier, earlierId).toBe(chargedCredits(table, quoteId))
        for (let hundredths = 180; hundredths <= 1200; hundredths++) {
          const price = seedanceExtendPrice({ duration: seconds, resolution, sourcePictureSec: hundredths / 100 })
          const charge = table.charge(price.rateId, quoteBaseCredits(table.base(price.rateId)!, price.units))
          if (charge > earlier!) throw new Error(`${hundredths / 100}s + ${seconds}s at ${resolution}: charge ${charge} above ${earlierId} ${earlier}`)
          cases++
        }
      }
    }
    expect(cases).toBe(27 * 3 * 1021)
  }, SWEEP_TIMEOUT_MS)

  // The shared builder every client prices an extend with names the
  // whole-window quote, reading the seconds added the way every lane reads
  // them: the same id as the rule's own price of a run whose source is not known.
  it("the shared builder names the whole-window quote, for every length, resolution and spelling", () => {
    const durationsTried: unknown[] = [undefined, "8", "12", "abc", -1, 0, 1, 3, 8.4, 31, 45, ...durations]
    const resolutionsTried: unknown[] = [undefined, "480p", "720p", "1080p", "4k", "2160p", 7]
    for (const duration of durationsTried) {
      for (const resolution of resolutionsTried) {
        const price = seedanceExtendPrice({ duration, resolution, sourcePictureSec: undefined })
        const expected = unitQuoteCreditId(price.rateId, price.units)
        const label = `${String(duration)} ${String(resolution)}`
        expect(tailExtendCreditId(provider, duration as number | string | undefined, resolution as string | undefined), label).toBe(expected)
        // A client's call on the retired id (the studio's), and on the provider itself.
        expect(buildVideoCreditModelIdentifier("seedance-2-extend", duration as number | string | undefined, undefined, undefined, undefined, resolution as string | undefined), label).toBe(expected)
        expect(buildVideoCreditModelIdentifier(provider, duration as number | string | undefined, undefined, undefined, undefined, resolution as string | undefined), label).toBe(expected)
        expect(parseRateQuoteCreditId(expected), label).toBeDefined()
      }
    }
    // Its default is the catalog's listed default run.
    expect(tailExtendCreditId(provider)).toBe(entry.pricing[0]!.identifier)
    expect(tailExtendCreditId(provider, 8, "720p")).toBe("seedance-2-5-extend:720p:per-2s:9u")
    expect(tailExtendCreditId(provider, 5, "480p")).toBe("seedance-2-5-extend:480p:per-2s:7.5u")
  })

  // The docs give credits = (sent + added) × the per-second price, rounded up
  // once; the charge rounds the two-second row × the units up, then marks it
  // up and rounds up again. The docs say a run can come to 1 credit more —
  // and never more than that. Exact integer arithmetic on the docs' side
  // (sources in hundredths of a second), at the docs' 10 percent.
  it("brute force: the charge is the docs formula or 1 credit more, never anything else", () => {
    const counts = { equal: 0, oneMore: 0 }
    for (let hundredths = 180; hundredths <= 1000; hundredths++) {
      for (const seconds of durations) {
        for (const resolution of RESOLUTIONS) {
          const rate = STATIC_CREDIT_COSTS[SEEDANCE_EXTEND_RATE_CREDIT_IDS[resolution]]!
          const charge = applyMarkupPercent(base25({ duration: seconds, resolution, sourcePictureSec: hundredths / 100 }), 10)
          const sentHundredths = Math.round(seedanceExtendPrice({ duration: seconds, resolution, sourcePictureSec: hundredths / 100 }).sentSec * 100)
          // (sent + added) × rate ÷ 2 × 110 ÷ 100, in hundredths of a second: an exact ceiling.
          const totalHundredths = sentHundredths + seconds * 100
          const docs = Math.ceil((totalHundredths * rate * 110) / 20000)
          const diff = charge - docs
          if (diff !== 0 && diff !== 1) throw new Error(`${hundredths / 100}s + ${seconds}s at ${resolution}: charge ${charge}, docs ${docs}`)
          if (diff === 0) counts.equal++
          else counts.oneMore++
        }
      }
    }
    expect(counts.equal + counts.oneMore).toBe(821 * 27 * 3)
    expect(counts.oneMore).toBeGreaterThan(0)
  }, SWEEP_TIMEOUT_MS)

  it("the earlier per-length rows stay as static twins of the model_pricing rows they seeded", () => {
    const earlier = Object.keys(STATIC_CREDIT_COSTS).filter((id) => /^seedance-2-5-extend:\d+s:/.test(id))
    expect(earlier.sort()).toEqual(durations.flatMap((s) => RESOLUTIONS.map((r) => `${provider}:${s}s:${r}`)).sort())
  })

  // The model guide and the listings show its default run: 8 s added to a
  // source of 10 s or more, 18 s sent and added — 9 units of the two-second
  // row, at each resolution, 720p (the default) first.
  it("the catalog lists the default run at each resolution, as a whole-run quote of its rate row, 720p first", () => {
    expect(entry.pricing.map((row) => [row.identifier, row.credits])).toEqual([
      ["seedance-2-5-extend:720p:per-2s:9u", 1710],
      ["seedance-2-5-extend:480p:per-2s:9u", 765],
      ["seedance-2-5-extend:1080p:per-2s:9u", 4275],
    ])
    for (const row of entry.pricing) {
      const resolution = row.identifier.split(":")[1]!
      expect(row.credits, row.identifier).toBe(base25({ duration: 8, resolution, sourcePictureSec: 25 }))
    }
  })

  // Decided 2026-11-12: a source of 2 s costs what it costs today, a 10 s
  // source with 8 s added at 720p about 18 × 104.5 ≈ 1881 instead of 1045.
  // Base, then charged at a 10 % markup (the docs' settings).
  it.each([
    [2, 950, 1045],
    [4, 1140, 1254],
    [10, 1710, 1881],
    [25, 1710, 1881],
  ])("a %s s source with 8 s added at 720p: base %s, charged %s at the docs' 10 percent markup", (sourceSec, base, charged) => {
    const b = base25({ duration: 8, resolution: "720p", sourcePictureSec: sourceSec })
    expect(b).toBe(base)
    expect(applyMarkupPercent(b, 10)).toBe(charged)
  })

  it("the seconds sent: the source's last 10 s, all of a shorter source, the whole window when unknown", () => {
    expect(seedanceExtendPrice({ duration: 8, resolution: "720p", sourcePictureSec: 25 })).toEqual({ rateId: "seedance-2-5-extend:720p:per-2s", units: 9, sentSec: 10, addedSec: 8 })
    expect(seedanceExtendPrice({ duration: 8, resolution: "720p", sourcePictureSec: 4.37 })).toMatchObject({ sentSec: 4.37, units: (4.37 + 8) / 2 })
    for (const unknown of [undefined, null, Number.NaN, 0, -1]) {
      expect(seedanceExtendPrice({ duration: 8, resolution: "720p", sourcePictureSec: unknown as number | undefined }).sentSec).toBe(SEEDANCE_EXTEND_CONTEXT_MAX_SEC)
    }
    // An unset length is the 8 s default; one outside the window is held in it.
    expect(seedanceExtendPrice({ duration: undefined, resolution: undefined, sourcePictureSec: 3 })).toMatchObject({ addedSec: 8, rateId: "seedance-2-5-extend:720p:per-2s" })
    expect(seedanceExtendPrice({ duration: 45, resolution: "480p", sourcePictureSec: 3 }).addedSec).toBe(30)
    expect(seedanceExtendPrice({ duration: 1, resolution: "480p", sourcePictureSec: 3 }).addedSec).toBe(4)
  })

  // Decided 2026-11-13: the source's seconds follow the platform's
  // container-overhang rule (`CONTAINER_OVERHANG_SEC`): at most a quarter
  // second past a whole second is that whole second; anything else is exact.
  it("the seconds sent follow the container-overhang rule: 8.04 s is 8 s, 8.3 s is 8.3 s", () => {
    const sent = (sec: number) => seedanceExtendPrice({ duration: 8, resolution: "720p", sourcePictureSec: sec }).sentSec
    expect(sent(8.04)).toBe(8)
    expect(sent(8.25)).toBe(8)
    expect(sent(8.3)).toBe(8.3)
    expect(sent(4.37)).toBe(4.37)
    expect(sent(1.97)).toBe(1.97)
    expect(sent(2.2)).toBe(2)
    expect(sent(10.2)).toBe(10)
    expect(sent(9.9)).toBe(9.9)
    // 8 s added at 720p: an 8.04 s source is charged as 8 s, an 8.3 s one as 8.3 s.
    expect(base25({ duration: 8, resolution: "720p", sourcePictureSec: 8.04 })).toBe(base25({ duration: 8, resolution: "720p", sourcePictureSec: 8 }))
    expect(base25({ duration: 8, resolution: "720p", sourcePictureSec: 8.04 })).toBe(1520)
    expect(base25({ duration: 8, resolution: "720p", sourcePictureSec: 8.3 })).toBe(Math.ceil(190 * (8.3 + 8) / 2))
  })

  // A quote that reads a source at a whole-second length its node recorded
  // (a generated video recorded at 8 s) is its charge whenever the picture
  // the run measures runs at most a quarter second past it.
  it("brute force: a picture with a container overhang is charged as its whole second, which a recorded whole-second quote equals", () => {
    let cases = 0
    for (let whole = 2; whole <= 60; whole++) {
      for (let overhang = 0; overhang <= 25; overhang++) {
        const measured = whole + overhang / 100
        for (const seconds of durations) {
          for (const resolution of RESOLUTIONS) {
            const charge = base25({ duration: seconds, resolution, sourcePictureSec: measured })
            const recordedQuote = base25({ duration: seconds, resolution, sourcePictureSec: whole })
            if (charge !== recordedQuote) throw new Error(`${measured}s + ${seconds}s at ${resolution}: charge ${charge}, quote at ${whole}s ${recordedQuote}`)
            cases++
          }
        }
      }
    }
    expect(cases).toBe(59 * 26 * 27 * 3)
  }, SWEEP_TIMEOUT_MS)

  // Every source length from the shortest a run takes (1.8 s) to 60 s, in
  // hundredths, every length a run can add and each resolution: a quote that
  // does not know the source (the whole window) is never below the charge, and
  // one that knows it is the charge.
  it("brute force: the quote is never below the charge, and equal when the source is known", () => {
    let cases = 0
    for (let hundredths = 180; hundredths <= 6000; hundredths++) {
      const sourceSec = hundredths / 100
      for (const seconds of durations) {
        for (const resolution of RESOLUTIONS) {
          const charge = base25({ duration: seconds, resolution, sourcePictureSec: sourceSec })
          const unknownQuote = base25({ duration: seconds, resolution, sourcePictureSec: undefined })
          const knownQuote = base25({ duration: seconds, resolution, sourcePictureSec: sourceSec })
          if (unknownQuote < charge || knownQuote !== charge) {
            throw new Error(`${sourceSec}s + ${seconds}s at ${resolution}: charge ${charge}, unknown quote ${unknownQuote}, known quote ${knownQuote}`)
          }
          // Charged (marked up once at the rate row): the same order holds.
          if (applyMarkupPercent(unknownQuote, 10) < applyMarkupPercent(charge, 10)) throw new Error(`marked up: ${sourceSec}s + ${seconds}s at ${resolution}`)
          cases++
        }
      }
    }
    expect(cases).toBe(5821 * 27 * 3)
  }, SWEEP_TIMEOUT_MS)
})
