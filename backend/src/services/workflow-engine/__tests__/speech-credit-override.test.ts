/**
 * Seam 2 — the workflow run reserves what the route's guard charges for the
 * same speech request: the model's :per-100-chars row × started hundreds (at
 * least 8), marked up once at the MODEL id's margin. Undefined for every other
 * job, and for every job while the flag is off (the DB-priced reservation then
 * runs untouched). Harness mirrors ltx-extend-override.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetAppSettings, flag } = vi.hoisted(() => ({ mockGetAppSettings: vi.fn(), flag: { on: true } }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000, ELEVENLABS_API_KEY: "k" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  speechLengthPricingEnabled: () => flag.on,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
  getModelCreditBaseCost: vi.fn(async (id: string) => ({
    creditCost: id === "elevenlabs-turbo:per-100-chars" ? 2 : id.endsWith(":per-100-chars") ? 4 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import { computeSpeechCreditOverride } from "../node-executor.js"
import { buildPayload } from "../payload-builder.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"
import { speechBaseCredits, dialogueBaseCredits } from "../../../lib/speech-credits.js"

describe("computeSpeechCreditOverride", () => {
  beforeEach(() => {
    flag.on = true
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 10 })
  })

  it.each([
    ["elevenlabs-v4", 100, 36],   // 8 × 4 = 32, +10% → 35.2 → 36
    ["elevenlabs-v3", 1000, 44],  // 40 → 44
    ["elevenlabs-turbo", 100, 18], // 16 → 17.6 → 18
    ["elevenlabs", 1000, 22],      // alias → turbo's row: 20 → 22
  ])("%s with %i characters → %i (marked up once)", async (provider, chars, credits) => {
    expect(await computeSpeechCreditOverride("text-to-speech", { provider, text: "a".repeat(chars) }, provider)).toBe(credits)
  })

  it("equals the route guard's number for the same request: applyServiceMarkup(speechBaseCredits(...))", async () => {
    const settings = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-v4": 37 } }
    mockGetAppSettings.mockResolvedValue(settings)
    for (const [provider, chars] of [["elevenlabs-v4", 1], ["elevenlabs-v4", 801], ["elevenlabs-v3", 5000], ["elevenlabs-turbo", 40000]] as const) {
      const text = "a".repeat(chars)
      const guard = applyServiceMarkup(await speechBaseCredits(provider, text), settings as never, provider)
      expect(await computeSpeechCreditOverride("text-to-speech", { provider, text }, provider), `${provider} ${chars}`).toBe(guard)
    }
  })

  it("the legacy alias is marked up at the model it runs as, so a margin on turbo reaches a node saved as 'elevenlabs' exactly as it reaches the REST guard", async () => {
    const settings = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-turbo": 40 } }
    mockGetAppSettings.mockResolvedValue(settings)
    const text = "a".repeat(800)
    // REST guards the alias as 'elevenlabs-turbo': 16 base × 1.40 = 22.4 → 23.
    const guard = applyServiceMarkup(await speechBaseCredits("elevenlabs-turbo", text), settings as never, "elevenlabs-turbo")
    expect(guard).toBe(23)
    const built = buildPayload({ id: "n1", type: "text-to-speech", data: { provider: "elevenlabs", voiceId: "Rachel", textSource: "direct", directText: text } }, "job-1", {})
    expect(await computeSpeechCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(guard)
  })

  it("dialogue: the sum of the lines on the dialogue row, marked up at the dialogue id", async () => {
    const dialogue = [{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }]
    const guard = applyServiceMarkup(await dialogueBaseCredits(dialogue), { cost_markup_percent: 10 } as never, "elevenlabs-dialogue")
    expect(await computeSpeechCreditOverride("text-to-dialogue", { dialogue }, "elevenlabs-dialogue")).toBe(guard)
    expect(guard).toBe(220)
  })

  it("prices the payload the builder actually sends", async () => {
    const built = buildPayload({ id: "n1", type: "text-to-speech", data: { provider: "elevenlabs-v3", voiceId: "Rachel", textSource: "direct", directText: "a".repeat(1000) } }, "job-1", {})
    expect(await computeSpeechCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(44)
  })

  it("leaves every other job alone", async () => {
    expect(await computeSpeechCreditOverride("generate-music", { prompt: "x" }, "generate-music")).toBeUndefined()
    expect(await computeSpeechCreditOverride("voice-changer", { audioUrl: "u" }, "elevenlabs-voice-changer")).toBeUndefined()
  })

  it("is undefined for every speech job while the flag is off — the DB-priced reservation runs untouched", async () => {
    flag.on = false
    expect(await computeSpeechCreditOverride("text-to-speech", { provider: "elevenlabs-v4", text: "a".repeat(5000) }, "elevenlabs-v4")).toBeUndefined()
    expect(await computeSpeechCreditOverride("text-to-dialogue", { dialogue: [{ text: "a", voice: "R" }] }, "elevenlabs-dialogue")).toBeUndefined()
  })
})
