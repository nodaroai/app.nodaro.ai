/**
 * GET /v1/nodes serves the credits a run is CHARGED, not the registry's base
 * figures — the Run button and this list must quote one price (item 5 of the
 * docs rebuild: "creditCost disagrees with the Run button").
 *
 * The prices come from `loadChargedPrices`; here it is a stand-in that marks
 * every static base up 10%, so each expectation below is derived, not typed.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/pricing/charged-prices.js", async () => {
  const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
  return {
    loadChargedPrices: async () => ({
      credits: (identifier: string, units = 1) => {
        const base = STATIC_CREDIT_COSTS[identifier]
        return base === undefined ? undefined : Math.ceil((base * units * 110) / 100)
      },
    }),
  }
})

import { nodesRoutes } from "../nodes.js"
import { CREDIT_BAND_SOURCES } from "../../lib/node-registry.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const charged = (identifier: string, units = 1) => Math.ceil((STATIC_CREDIT_COSTS[identifier]! * units * 110) / 100)

function chargedBand(type: string): number | string {
  const source = CREDIT_BAND_SOURCES[type]!
  const [minUnits, maxUnits] = source.span ?? [1, 1]
  const priced = source.ids.filter((id) => STATIC_CREDIT_COSTS[id] !== undefined)
  const min = Math.min(...priced.map((id) => charged(id, minUnits)))
  const max = Math.max(...priced.map((id) => charged(id, maxUnits)))
  return min === max ? min : `${min}-${max}`
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(async (instance) => nodesRoutes(instance))
  await app.ready()
})

async function listed(type: string): Promise<number | string | undefined> {
  const body = (await app.inject({ method: "GET", url: "/v1/nodes" })).json() as {
    data: Array<{ type: string; creditCost?: number | string }>
  }
  return body.data.find((n) => n.type === type)?.creditCost
}

describe("GET /v1/nodes — the charged price", () => {
  it("a flat node lists its own row, charged (Extract Audio: base 10, charged 11)", async () => {
    expect(STATIC_CREDIT_COSTS["extract-audio"]).toBe(10)
    expect(await listed("extract-audio")).toBe(11)
    expect(await listed("merge-video-audio")).toBe(charged("merge-video-audio"))
  })

  it("a band takes each end from the charged price of its members", async () => {
    expect(await listed("generate-image")).toBe(chargedBand("generate-image"))
    expect(await listed("image-to-video")).toBe(chargedBand("image-to-video"))
  })

  it("a rate band multiplies the rate before the charge (Video Retake, 2 s to 10 s)", async () => {
    expect(await listed("video-retake")).toBe(chargedBand("video-retake"))
  })

  it("figures that are not a price stay as declared", async () => {
    expect(await listed("apply-edl")).toBe("per-minute")
    expect(await listed("composite")).toBe(0)
  })

  it("/v1/nodes/:type quotes the same charged price as the list", async () => {
    const detail = (await app.inject({ method: "GET", url: "/v1/nodes/extract-audio" })).json() as {
      data: { creditCost?: number }
    }
    expect(detail.data.creditCost).toBe(11)
  })
})
