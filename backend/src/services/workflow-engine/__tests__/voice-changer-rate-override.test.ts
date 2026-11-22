/**
 * Voice Changer — the workflow run's reservation (decided 2026-11-22).
 *
 * The run stamps the audio's length and units (`stampVoiceChangerInput`,
 * lib/__tests__/voice-changer-input.test.ts) and
 * `computeVoiceChangerCreditOverride` reserves the per-10-second row × the
 * units, rounded up once, marked up once — what the route's guard holds for
 * the same audio. Harness mirrors audio-isolation-rate-override.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetAppSettings } = vi.hoisted(() => ({ mockGetAppSettings: vi.fn() }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
  getModelCreditBaseCost: vi.fn(async (id: string) => ({
    creditCost: id === "elevenlabs-voice-changer:per-10s" ? 10 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import { computeVoiceChangerCreditOverride } from "../node-executor.js"
import type { FastifyRequest } from "fastify"
import { voiceChangerComputeCredits } from "../../../routes/voice-changer.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"

const ID = "elevenlabs-voice-changer:per-10s"
const SETTINGS = { cost_markup_percent: 10 }

describe("computeVoiceChangerCreditOverride", () => {
  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue(SETTINGS)
  })

  it.each([
    [1, 10],
    [3, 30],
    [6, 60],
    [30, 300],
  ])("%i units: base %i, marked up once", async (units, base) => {
    expect(await computeVoiceChangerCreditOverride("voice-changer", { voiceChangerUnits: units }, ID)).toBe(applyServiceMarkup(base, SETTINGS as never, ID))
  })

  it("at the docs' 10% the worked examples are 11, 33, 66, 132 and 330 credits", async () => {
    const charged: Array<number | undefined> = []
    for (const units of [1, 3, 6, 12, 30]) charged.push(await computeVoiceChangerCreditOverride("voice-changer", { voiceChangerUnits: units }, ID))
    expect(charged).toEqual([11, 33, 66, 132, 330])
  })

  it("is exactly what the route's guard holds for the same audio (computeCredits, marked up once)", async () => {
    for (const units of [1, 2, 3, 6, 12, 30]) {
      const req = { requestMeasures: { voiceChanger: { audioSec: units * 10, units } } } as unknown as FastifyRequest
      const routeBase = await voiceChangerComputeCredits({}, req)
      const routeHold = applyServiceMarkup(routeBase, SETTINGS as never, ID)
      expect(await computeVoiceChangerCreditOverride("voice-changer", { voiceChangerUnits: units }, ID)).toBe(routeHold)
    }
  })

  it("a run that reached its reservation without the audio's length is refused, never priced at a guess; another job has no override", async () => {
    await expect(computeVoiceChangerCreditOverride("voice-changer", {}, ID)).rejects.toThrow(/without the length/)
    expect(await computeVoiceChangerCreditOverride("audio-isolation", { voiceChangerUnits: 3 }, ID)).toBeUndefined()
  })
})
