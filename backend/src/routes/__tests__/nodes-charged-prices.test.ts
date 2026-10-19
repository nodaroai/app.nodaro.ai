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
      rate: (identifier: string) => {
        const base = STATIC_CREDIT_COSTS[identifier]
        return base === undefined ? undefined : Math.ceil(base * 100 * 1.1 - 1e-9) / 100
      },
    }),
  }
})

import { USE_CASE_NODE_TYPES, usecaseFeeCreditId } from "@nodaro/render-rules"
import { nodesRoutes } from "../nodes.js"
import { CREDIT_BAND_SOURCES, NODE_REGISTRY, USE_CASE_FEE_SENTENCE, usecaseFeeSentence } from "../../lib/node-registry.js"
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

  it("a per-unit node keeps its word and adds the charged rate of one unit (Speaker Frames: base 2 a block, charged 2.2)", async () => {
    expect(STATIC_CREDIT_COSTS["speaker-frames"]).toBe(2)
    const body = (await app.inject({ method: "GET", url: "/v1/nodes/speaker-frames" })).json() as {
      data: { creditCost?: number | string; creditRate?: Record<string, unknown> }
    }
    expect(body.data.creditCost).toBe("per-1000-frames")
    expect(body.data.creditRate).toMatchObject({
      identifier: "speaker-frames",
      unit: "1000-frames",
      creditsPerUnit: 2.2,
      minUnits: 1,
      rounding: "ceil-run-total",
    })
    // No other node carries one.
    const list = (await app.inject({ method: "GET", url: "/v1/nodes" })).json() as {
      data: Array<{ type: string; creditRate?: unknown }>
    }
    expect(list.data.filter((n) => n.creditRate !== undefined).map((n) => n.type)).toEqual(["speaker-frames"])
  })

  it("a use-case node states its per-run fee at the charged price, never a static figure (base 10, charged 11)", async () => {
    expect(charged("use-case-fee:tighten-episode")).toBe(11)
    const list = (await app.inject({ method: "GET", url: "/v1/nodes" })).json() as {
      data: Array<{ type: string; description: string }>
    }
    for (const type of USE_CASE_NODE_TYPES) {
      // The registry names no figure; the served description names the charged one.
      const declared = NODE_REGISTRY.find((n) => n.type === type)!.description
      expect(declared.endsWith(USE_CASE_FEE_SENTENCE), type).toBe(true)
      expect(declared, type).not.toMatch(/\d+ credits/)
      const served = list.data.find((n) => n.type === type)!.description
      expect(served, type).toBe(declared.slice(0, -USE_CASE_FEE_SENTENCE.length) + usecaseFeeSentence(charged(usecaseFeeCreditId(type))))
      expect(served, type).toMatch(/plus a per-run fee of 11 credits\.$/)
    }
  })

  it("/v1/nodes/:type quotes the same charged price as the list", async () => {
    const detail = (await app.inject({ method: "GET", url: "/v1/nodes/extract-audio" })).json() as {
      data: { creditCost?: number }
    }
    expect(detail.data.creditCost).toBe(11)
  })
})
