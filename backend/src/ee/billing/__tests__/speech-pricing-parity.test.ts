/**
 * Every seam that reserves speech credits charges the SAME number for the same
 * (model, text): the REST guard's computeCredits, the orchestrator's override
 * and the shared formula over the one character count. Flag on: all equal
 * `speechCredits(billable, row)` marked up once at the model id. Flag off: the
 * route passes no hook and the override is undefined — today's flat row, exactly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetAppSettings, flag } = vi.hoisted(() => ({ mockGetAppSettings: vi.fn(), flag: { on: true } }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000, ELEVENLABS_API_KEY: "k", SUPABASE_URL: "https://t.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "t" },
  hasCredits: () => true, isCloud: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
  speechLengthPricingEnabled: () => flag.on,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/url-validator.js", async () => ({ safeUrlSchema: (await import("zod")).z.string().url() }))

const ROWS: Record<string, number> = {
  "elevenlabs-v3": 30, "elevenlabs-v4": 30, "elevenlabs-multilingual": 30, "elevenlabs-turbo": 15, "elevenlabs": 15, "elevenlabs-dialogue": 25, "elevenlabs-dialogue-v4": 25,
  "elevenlabs-v3:per-100-chars": 4, "elevenlabs-v4:per-100-chars": 4, "elevenlabs-multilingual:per-100-chars": 4,
  "elevenlabs-turbo:per-100-chars": 2, "elevenlabs-dialogue:per-100-chars": 4,
  "elevenlabs-dialogue-v4:per-100-chars": 4,
}
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
  getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: ROWS[id] ?? 999, isEnabled: true, tierRestriction: null })),
}))

import { getDialogueCapabilities, speechCredits, speechUnitCreditId } from "@nodaro/shared"
import { applyServiceMarkup } from "../service-margin.js"
import { billableSpeechChars, billableDialogueChars, speechBaseCredits, dialogueBaseCredits, speechRunsAs } from "../../../lib/speech-credits.js"
import { speechChargeOverride } from "../../../lib/speech-estimate.js"
import { voicedAddonBaseCredits, voicedAddonCreditId } from "../../../lib/voiced-dialogue-lines.js"
import { computeSpeechCreditOverride } from "../../../services/workflow-engine/node-executor.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveTextToSpeechGuardProvider } from "../../../routes/text-to-speech.js"
import { SPEECH_PARITY_CASES } from "../../../lib/__tests__/speech-parity-cases.js"

const SETTINGS = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-v3": 25, "elevenlabs-turbo": 40 } }
// ONE table for every parity suite (the workflow estimate and the UGC quote read it too).
const CASES = SPEECH_PARITY_CASES

beforeEach(() => { flag.on = true; mockGetAppSettings.mockResolvedValue(SETTINGS) })

describe("speech pricing — the seams agree (flag on)", () => {
  it.each(CASES)("text-to-speech provider %j, %j", async (provider, text) => {
    const guardProvider = resolveTextToSpeechGuardProvider({ provider, text })
    const expectedBase = speechCredits(billableSpeechChars(guardProvider, text), ROWS[speechUnitCreditId(speechRunsAs(guardProvider))]!)
    const expectedCharge = applyServiceMarkup(expectedBase, SETTINGS as never, guardProvider)
    // Seam 1: the route guard's base (markup is applied by credit-guard-impl at the model id).
    expect(await speechBaseCredits(guardProvider, text)).toBe(expectedBase)
    // Seam 2: the orchestrator, from the payload the builder sends for the same node (within the cap).
    if (text.length <= 40000 && (provider !== "elevenlabs-v3" || text.length <= 5000)) {
      const built = buildPayload({ id: "n", type: "text-to-speech", data: { ...(provider ? { provider } : {}), voiceId: "Rachel", textSource: "direct", directText: text } }, "j", {})
      // The two lanes bill the same MODEL and mark it up at the same id: the legacy alias is guarded as
      // `elevenlabs-turbo` by the route, and the orchestrator resolves it to the model it runs as, so a
      // per-service margin on turbo reaches both (SETTINGS carries one) — same number, whichever seam.
      expect(speechRunsAs(built.modelIdentifier)).toBe(speechRunsAs(guardProvider))
      expect(await computeSpeechCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(expectedCharge)
      // Seam 3 reads the lifted override directly (the pipeline services): the same function, the same number.
      expect(await speechChargeOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(expectedCharge)
    }
    // PR 1B: a sole character voice on this model voices the line as its own text-to-speech
    // request (joined, unclamped, tags stripped where the model does not perform them) — the
    // guard's base for the same text. The planner drops a line over the dialogue total cap; a
    // voice that names NO model is sent to the fallback model (its own rule), not the REST
    // route's omitted-provider rule, so the omitted rows are not compared here.
    if (provider !== undefined && text.length <= getDialogueCapabilities("elevenlabs-dialogue").maxChars) {
      const body = { dialogue: [{ speaker: "Anna", line: text }], characterVoices: [{ voiceId: "v", ttsProvider: provider, speaker: "Anna" }] }
      expect(voicedAddonCreditId(body)).toBe(speechRunsAs(guardProvider))
      expect(await voicedAddonBaseCredits(body)).toBe(expectedBase)
    }
  })

  it("the voiced add-on for a multi-voice cast is the dialogue script's base on the cast's dialogue model", async () => {
    const lines = [{ speaker: "Anna", line: "a".repeat(1234) }, { speaker: "Ben", line: "[laughs] " + "b".repeat(900) }]
    const voices = [{ voiceId: "va", ttsProvider: "elevenlabs-v4", speaker: "Anna" }, { voiceId: "vb", ttsProvider: "elevenlabs-v4", speaker: "Ben" }]
    const body = { dialogue: lines, characterVoices: voices }
    // Every voice on v4 → the v4 dialogue model; its script is the sum of the lines.
    expect(voicedAddonCreditId(body)).toBe("elevenlabs-dialogue-v4")
    expect(await voicedAddonBaseCredits(body)).toBe(await dialogueBaseCredits(lines.map((l) => ({ text: l.line, voice: l.speaker })), "elevenlabs-dialogue-v4"))
  })

  it("the REST route prices the clamped text: 6,000 characters on v3 reserve what 5,000 do", async () => {
    expect(await speechBaseCredits("elevenlabs-v3", "a".repeat(6000))).toBe(await speechBaseCredits("elevenlabs-v3", "a".repeat(5000)))
  })

  it("dialogue: guard base and orchestrator override agree", async () => {
    const dialogue = [{ text: "a".repeat(1234), voice: "Rachel" }, { text: "[laughs] " + "b".repeat(900), voice: "George" }]
    const base = speechCredits(billableDialogueChars(dialogue), 4)
    expect(await dialogueBaseCredits(dialogue)).toBe(base)
    const built = buildPayload({ id: "n", type: "text-to-dialogue", data: { dialogue } }, "j", {})
    expect(await computeSpeechCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(applyServiceMarkup(base, SETTINGS as never, "elevenlabs-dialogue"))
  })

  it("v4 dialogue: guard base and orchestrator override agree, on v4's own unit row and its own margin id", async () => {
    const dialogue = [{ text: "a".repeat(1234), voice: "Rachel" }, { text: "b".repeat(900), voice: "George" }]
    const base = speechCredits(billableDialogueChars(dialogue, "elevenlabs-dialogue-v4"), 4)
    expect(await dialogueBaseCredits(dialogue, "elevenlabs-dialogue-v4")).toBe(base)
    const built = buildPayload({ id: "n", type: "text-to-dialogue", data: { dialogue, provider: "elevenlabs-dialogue-v4" } }, "j", {})
    expect(await computeSpeechCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(applyServiceMarkup(base, SETTINGS as never, "elevenlabs-dialogue-v4"))
  })
})

describe("speech pricing — flag off is today", () => {
  it("the orchestrator override is undefined for every case (the flat row reserves)", async () => {
    flag.on = false
    for (const [provider, text] of CASES) {
      expect(await computeSpeechCreditOverride("text-to-speech", { provider, text }, provider ?? "elevenlabs-v4")).toBeUndefined()
      expect(await speechChargeOverride("text-to-speech", { provider, text }, provider ?? "elevenlabs-v4")).toBeUndefined()
    }
  })

  it("the voiced add-on is the cast's dialogue model's flat row, whatever the text", async () => {
    flag.on = false
    const sole = { dialogue: [{ speaker: "Anna", line: "a".repeat(3000) }], characterVoices: [{ voiceId: "v", ttsProvider: "elevenlabs-turbo", speaker: "Anna" }] }
    expect(await voicedAddonBaseCredits(sole)).toBe(ROWS["elevenlabs-dialogue"])
    const v4Cast = { dialogue: [{ speaker: "A", line: "x" }, { speaker: "B", line: "y" }], characterVoices: [{ voiceId: "a", ttsProvider: "elevenlabs-v4", speaker: "A" }, { voiceId: "b", ttsProvider: "elevenlabs-v4", speaker: "B" }] }
    expect(await voicedAddonBaseCredits(v4Cast)).toBe(ROWS["elevenlabs-dialogue-v4"])
  })
  // The route side of "flag off" is pinned in routes/__tests__/speech-length-pricing-routes.test.ts
  // (no computeCredits is passed at registration).
})
