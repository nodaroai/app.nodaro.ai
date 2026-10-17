// @test-units-by-name looks up only speaker-frames and the node types CREDIT_RATE_SOURCES names
/**
 * `creditRate` on a served descriptor is the charged price of ONE unit, exact,
 * and its rounding rule — so a client multiplying it reaches the price a run
 * is charged, which `GET /v1/credits/model-cost` (one unit, rounded up) cannot
 * give. Held here to the server's own whole-run charge (`statedPrices()`, the
 * price-table rule at the hosted deployment's settings — the rule the docs are
 * held to), never to a number typed into the test.
 */
import { describe, it, expect } from "vitest"
import { SPEAKER_FRAMES_CREDIT_ID } from "@nodaro/render-rules"
import { NODE_REGISTRY, CREDIT_RATE_SOURCES, chargedDescriptor } from "../node-registry.js"
import { statedPrices } from "../../ee/billing/stated-prices.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const prices = statedPrices()
const served = (type: string) => chargedDescriptor(NODE_REGISTRY.find((d) => d.type === type)!, prices)

describe("creditRate", () => {
  it("Speaker Frames serves its per-block rate, charged, beside its per-unit word", () => {
    const desc = served("speaker-frames")
    expect(desc.creditCost).toBe("per-1000-frames")
    expect(desc.creditRate).toEqual({
      identifier: SPEAKER_FRAMES_CREDIT_ID,
      unit: "1000-frames",
      creditsPerUnit: prices.rateOf(SPEAKER_FRAMES_CREDIT_ID),
      minUnits: 1,
      rounding: "ceil-run-total",
      note: CREDIT_RATE_SOURCES["speaker-frames"]!.note,
    })
    // The rate is the charged one, not the price-table row.
    expect(desc.creditRate!.creditsPerUnit).toBeGreaterThan(STATIC_CREDIT_COSTS[SPEAKER_FRAMES_CREDIT_ID] as number)
  })

  it("ceil(blocks × creditsPerUnit) is what a run of those blocks is charged — and model-cost's one block is the minimum", () => {
    const rate = served("speaker-frames").creditRate!
    for (const blocks of [1, 2, 6, 11, 130]) {
      expect(Math.ceil(blocks * rate.creditsPerUnit - 1e-9), `${blocks} blocks`).toBe(prices.credits(SPEAKER_FRAMES_CREDIT_ID, blocks))
    }
    // One block's price, rounded up per unit, overshoots a multi-block run.
    const oneBlock = prices.credits(SPEAKER_FRAMES_CREDIT_ID)!
    expect(oneBlock * 11).toBeGreaterThan(prices.credits(SPEAKER_FRAMES_CREDIT_ID, 11)!)
  })

  it("every declared rate names a priced id, on a node whose creditCost is a word", () => {
    for (const [type, source] of Object.entries(CREDIT_RATE_SOURCES)) {
      const desc = NODE_REGISTRY.find((d) => d.type === type)
      expect(desc, type).toBeDefined()
      expect(typeof desc!.creditCost, type).toBe("string")
      expect(STATIC_CREDIT_COSTS[source.identifier], type).toBeTypeOf("number")
      // The static registry never carries a price of its own.
      expect(desc!.creditRate, type).toBeUndefined()
    }
  })

  it("nothing is served where nothing is charged (no creditCost, no prices)", () => {
    const { creditCost: _omit, ...free } = NODE_REGISTRY.find((d) => d.type === "speaker-frames")!
    expect(chargedDescriptor(free, prices).creditRate).toBeUndefined()
    const none = { credits: () => undefined, rate: () => undefined }
    expect(chargedDescriptor(NODE_REGISTRY.find((d) => d.type === "speaker-frames")!, none).creditRate).toBeUndefined()
  })
})
