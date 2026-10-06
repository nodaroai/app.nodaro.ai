/**
 * The workflow estimate — behind published apps, templates, components,
 * `get_app_inputs`, `POST /v1/credits/estimate-workflow` and the editor's Run
 * total — prices a speech node by length while the flag is on: the model's
 * :per-100-chars row × started hundreds of the text the run will send, marked
 * up once, the route guard's own number. A text that arrives at run time is
 * the cap, tightened by an exposed input's character limit. Flag off is the
 * flat row, whatever the text — today's number byte for byte.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { flag, settings } = vi.hoisted(() => ({
  flag: { on: true },
  settings: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> },
}))

// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS.
function modelPricingQuery() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
  }
  return query
}
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => flag.on }
})

import { getDialogueCapabilities, speechPriceUnits } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS, estimateWorkflowListingCredits, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { dialogueBaseCredits, speechBaseCredits, speechRunsAs } from "../../../lib/speech-credits.js"
import { resolveTextToSpeechGuardProvider } from "../../../routes/text-to-speech.js"
import { DIALOGUE_PARITY_CASES, SPEECH_PARITY_CASES } from "../../../lib/__tests__/speech-parity-cases.js"

beforeEach(() => {
  flag.on = true
  settings.cost_markup_percent = 10
  settings.service_margin_percent = {}
  invalidateModelPricingCache()
})

describe("estimateWorkflowCredits — speech by length (flag on)", () => {
  it("the fixture's Text node has no price row of its own", () => {
    expect(STATIC_CREDIT_COSTS["text-prompt"]).toBeUndefined()
  })

  it("a literal text-to-speech node is the unit row × started hundreds, marked up once — the route guard's number", async () => {
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(1000) } }
    expect(await CreditsService.estimateWorkflowCredits([node])).toBe(44) // 10 × 4 = 40, +10% → 44
    expect(CreditsService.estimateWorkflowBaseCredits([node])).toBe(40)
  })

  it("a wired text is the cap; an exposed input's limit tightens it (options.speechTextCaps, keyed node:field)", async () => {
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v4", textSource: "connected" } }
    expect(CreditsService.estimateWorkflowBaseCredits([node])).toBe(400) // 100 units × 4
    // a direct-text cap does not apply to a connected text
    expect(CreditsService.estimateWorkflowBaseCredits([node], undefined, { speechTextCaps: { "t:directText": 1200 } })).toBe(400)
    const text = { id: "s", type: "text-prompt", data: { text: "a".repeat(2500) } }
    const edge = { source: "s", target: "t", targetHandle: "prompt" }
    expect(CreditsService.estimateWorkflowBaseCredits([node, text], [edge])).toBe(100) // the upstream literal: 25 × 4
    expect(CreditsService.estimateWorkflowBaseCredits([node, text], [edge], { speechTextCaps: { "s:text": 1200 } })).toBe(48) // the Text node's exposed input: 12 × 4
    expect(CreditsService.estimateWorkflowBaseCredits([node, text], [edge], { speechTextCaps: { "s:text": null } })).toBe(400) // exposed, no limit: the placeholder is not the text that runs
    const direct = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v4", textSource: "direct", directText: "a".repeat(200) } }
    expect(CreditsService.estimateWorkflowBaseCredits([direct])).toBe(32) // literal, unexposed: exact (the floor)
    expect(CreditsService.estimateWorkflowBaseCredits([direct], [], { speechTextCaps: { "t:directText": null } })).toBe(400)
    expect(CreditsService.estimateWorkflowBaseCredits([direct], [], { speechTextCaps: { "t:directText": 1500 } })).toBe(60) // 15 × 4
  })

  it("the listing estimate carries the caps through (the publish path's entry)", async () => {
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v4", textSource: "direct", directText: "a".repeat(200) } }
    expect((await estimateWorkflowListingCredits([node], [], { publishType: "app", speechTextCaps: { "t:directText": null } })).preview).toBe(440)
    expect((await estimateWorkflowListingCredits([node], [], { publishType: "app" })).preview).toBe(36) // 32 + 10% → 35.2 → 36
  })

  it("a dialogue node prices its lines on its own model's unit row", async () => {
    const v4 = { id: "d", type: "text-to-dialogue", data: { provider: "elevenlabs-dialogue-v4", dialogue: [{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }] } }
    expect(CreditsService.estimateWorkflowBaseCredits([v4])).toBe(200)
    const v3 = { id: "d", type: "text-to-dialogue", data: { dialogue: [{ text: "{Script}", voice: "R" }] } }
    // a reference in a line: the dialogue model's total cap, in units, on its row
    expect(CreditsService.estimateWorkflowBaseCredits([v3])).toBe(speechPriceUnits(getDialogueCapabilities("elevenlabs-dialogue").maxChars) * 4)
  })

  it("a per-service margin on the MODEL id reaches the estimate (prefix on the unit id)", async () => {
    settings.service_margin_percent = { "elevenlabs-v4": 37 }
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v4", textSource: "direct", directText: "a".repeat(100) } }
    expect(await CreditsService.estimateWorkflowCredits([node])).toBe(Math.ceil(32 * 1.37))
  })

  it("the speech branch sits after the parameter-node skip and does not touch other nodes", async () => {
    const image = { id: "i", type: "generate-image", data: { provider: "gemini-omni" } }
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(1000) } }
    const alone = CreditsService.estimateWorkflowBaseCredits([image])
    expect(CreditsService.estimateWorkflowBaseCredits([image, node])).toBe(alone + 40)
  })
})

// Parity (Task 10): for every (model, text) the seams agree on, the estimate of a
// LITERAL node equals the route guard's own base — the estimator and the guard
// read the one counter and the one row — and the charged estimate equals the
// guard's charge: the unit id carries the model's per-service margin by prefix.
describe("estimateWorkflowCredits — the estimate of a literal node is the route guard's number", () => {
  const SETTINGS = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-v3": 25, "elevenlabs-turbo": 40 } }
  beforeEach(() => {
    settings.cost_markup_percent = SETTINGS.cost_markup_percent
    settings.service_margin_percent = { ...SETTINGS.service_margin_percent }
  })

  it.each(SPEECH_PARITY_CASES)("text-to-speech provider %j, %j", async (provider, text) => {
    const guardProvider = resolveTextToSpeechGuardProvider({ provider, text })
    const node = { id: "t", type: "text-to-speech", data: { ...(provider ? { provider } : {}), textSource: "direct", directText: text } }
    const base = await speechBaseCredits(guardProvider, text)
    expect(CreditsService.estimateWorkflowBaseCredits([node])).toBe(base)
    expect(await CreditsService.estimateWorkflowCredits([node])).toBe(applyServiceMarkup(base, SETTINGS as never, speechRunsAs(guardProvider)))
  })

  it.each(DIALOGUE_PARITY_CASES)("text-to-dialogue provider %j", async (provider, lines) => {
    const node = { id: "d", type: "text-to-dialogue", data: { ...(provider ? { provider } : {}), dialogue: [...lines] } }
    expect(CreditsService.estimateWorkflowBaseCredits([node])).toBe(await dialogueBaseCredits(lines, provider))
  })
})

describe("estimateWorkflowCredits — flag off is today", () => {
  beforeEach(() => {
    flag.on = false
  })

  it("quotes the flat row, whatever the text", async () => {
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(5000) } }
    expect(CreditsService.estimateWorkflowBaseCredits([node])).toBe(30)
    expect(await CreditsService.estimateWorkflowCredits([node])).toBe(33)
    expect(CreditsService.estimateWorkflowBaseCredits([{ id: "d", type: "text-to-dialogue", data: { dialogue: [{ text: "a", voice: "R" }] } }])).toBe(25)
    expect(CreditsService.estimateWorkflowBaseCredits([{ id: "t", type: "text-to-speech", data: { provider: "elevenlabs", textSource: "connected" } }])).toBe(STATIC_CREDIT_COSTS["elevenlabs-turbo"])
  })

  it("ignores speechTextCaps entirely", async () => {
    const node = { id: "t", type: "text-to-speech", data: { provider: "elevenlabs-v4", textSource: "direct", directText: "a".repeat(200) } }
    expect((await estimateWorkflowListingCredits([node], [], { publishType: "app", speechTextCaps: { "t:directText": null } })).preview).toBe(33)
  })
})
