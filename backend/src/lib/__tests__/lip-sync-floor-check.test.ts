/**
 * The balance check a Lip Sync on a model priced by its audio's length runs
 * BEFORE the audio is downloaded (decided 2026-11-13): the model's cheapest
 * run, charged, against the payer's balance by the guard's own rule
 * (`checkPayerCanAfford`), answered with the guard's own 402. Cloud only;
 * anything it cannot price or check refuses nothing (the guard checks the
 * measured run).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  credits: true,
  priced: [] as string[],
  asked: [] as number[],
  affordable: true,
  priceFails: false,
  consentPending: false,
}))
vi.mock("../../ee/lib/welcome-consent-gate.js", () => ({ consentPendingFor: async () => state.consentPending }))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasCredits: () => state.credits,
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    getModelCreditCost: async (id: string) => {
      state.priced.push(id)
      if (state.priceFails) throw new Error("price not configured")
      return id.endsWith(":4u") ? 154 : 330
    },
  },
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  checkPayerCanAfford: async (_req: unknown, credits: number) => {
    state.asked.push(credits)
    return state.affordable ? { ok: true } : { ok: false, statusCode: 402, body: { error: { code: "insufficient_credits" } } }
  },
}))

import { lipSyncFloorCreditId, lipSyncFloorRefusal } from "../lip-sync-floor-check.js"
import { lipSyncAudioPricingOf } from "../lip-sync-inputs.js"

const req = { userId: "u1" } as never

beforeEach(() => {
  state.credits = true
  state.priced = []
  state.asked = []
  state.affordable = true
  state.priceFails = false
  state.consentPending = false
})

describe("the balance check before a Lip Sync's audio is measured", () => {
  it("prices each model's cheapest run: a bucketed model's 15 s tier, a per-second-rate model's minimum seconds", () => {
    expect(lipSyncFloorCreditId(lipSyncAudioPricingOf("kling-avatar")!)).toBe("kling-avatar:15s")
    expect(lipSyncFloorCreditId(lipSyncAudioPricingOf("omnihuman-1-5")!)).toBe("omnihuman-1-5:15s")
    expect(lipSyncFloorCreditId(lipSyncAudioPricingOf("volcengine-lipsync")!)).toBe("volcengine-lipsync:15s")
    expect(lipSyncFloorCreditId(lipSyncAudioPricingOf("omnihuman-2-0")!)).toBe("omnihuman-2-0:per-second:4u")
  })

  it("a payer who cannot cover it gets the guard's own answer; one who can passes", async () => {
    state.affordable = false
    expect(await lipSyncFloorRefusal(req, lipSyncAudioPricingOf("kling-avatar")!)).toEqual({ statusCode: 402, body: { error: { code: "insufficient_credits" } } })
    expect(state.asked).toEqual([330])
    state.affordable = true
    expect(await lipSyncFloorRefusal(req, lipSyncAudioPricingOf("omnihuman-2-0")!)).toBeUndefined()
    expect(state.asked).toEqual([330, 154])
  })

  it("an account that still owes its consent is left to the guard's consent ask, never a 402 here", async () => {
    state.affordable = false
    state.consentPending = true
    expect(await lipSyncFloorRefusal(req, lipSyncAudioPricingOf("kling-avatar")!)).toBeUndefined()
  })

  it("without a credit system, or when the floor cannot be priced, it refuses nothing (the guard checks the measured run)", async () => {
    state.affordable = false
    state.credits = false
    expect(await lipSyncFloorRefusal(req, lipSyncAudioPricingOf("kling-avatar")!)).toBeUndefined()
    expect(state.priced).toEqual([])
    state.credits = true
    state.priceFails = true
    expect(await lipSyncFloorRefusal(req, lipSyncAudioPricingOf("kling-avatar")!)).toBeUndefined()
    expect(state.asked).toEqual([])
  })
})
