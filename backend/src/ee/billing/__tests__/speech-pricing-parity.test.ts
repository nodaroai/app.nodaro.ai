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

import { speechCredits, speechUnitCreditId } from "@nodaro/shared"
import { applyServiceMarkup } from "../service-margin.js"
import { billableSpeechChars, billableDialogueChars, speechBaseCredits, dialogueBaseCredits, speechRunsAs } from "../../../lib/speech-credits.js"
import { computeSpeechCreditOverride } from "../../../services/workflow-engine/node-executor.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveTextToSpeechGuardProvider } from "../../../routes/text-to-speech.js"

const SETTINGS = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-v3": 25, "elevenlabs-turbo": 40 } }
const CASES: Array<[provider: string | undefined, text: string]> = [
  ["elevenlabs-v4", ""], ["elevenlabs-v4", "a"], ["elevenlabs-v4", "a".repeat(100)], ["elevenlabs-v4", "a".repeat(101)],
  ["elevenlabs-v4", "a".repeat(800)], ["elevenlabs-v4", "a".repeat(801)], ["elevenlabs-v4", "a".repeat(10000)],
  ["elevenlabs-v3", "a".repeat(5000)], ["elevenlabs-v3", "[laughs] " + "a".repeat(700)],
  ["elevenlabs-turbo", "[whispers] [laughs] " + "a".repeat(1000)], ["elevenlabs-turbo", "a".repeat(40000)],
  ["elevenlabs-multilingual", "😀".repeat(50)], ["elevenlabs", "a".repeat(1000)],
  [undefined, "a".repeat(100)], [undefined, "a".repeat(12000)],
]

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
    }
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
    }
  })
  // The route side of "flag off" is pinned in routes/__tests__/speech-length-pricing-routes.test.ts
  // (no computeCredits is passed at registration).
})
