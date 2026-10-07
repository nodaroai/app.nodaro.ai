/**
 * One reading of "which lines will a voiced-video run voice, and on which
 * model" for the generate-video route's reservation and the worker's synthesis
 * — the add-on is priced for exactly the text and the model that run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ELEVENLABS_API_KEY: "k" },
  hasCredits: () => true, isCloud: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
  speechLengthPricingEnabled: () => flag.on,
}))
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: vi.fn(async (id: string) => ({
    creditCost: id === "elevenlabs-dialogue" || id === "elevenlabs-dialogue-v4" ? 25 : id === "elevenlabs-turbo:per-100-chars" ? 2 : id.endsWith(":per-100-chars") ? 4 : 999,
    isEnabled: true, tierRestriction: null,
  })),
}))

import { getMaxTtsChars } from "@nodaro/shared"
import { stripAudioTags } from "../../providers/elevenlabs/audio-tags.js"
import { planVoicedDialogue, voicedAddonBaseCredits, voicedAddonCreditId } from "../voiced-dialogue-lines.js"

const ANNA = { voiceId: "anna-id", ttsProvider: "elevenlabs-v4" as const, speaker: "Anna" }
const BOB = { voiceId: "bob-id", speaker: "Bob" }
const CARA = { voiceId: "cara-id", ttsProvider: "elevenlabs-v4" as const, speaker: "Cara" }
const DAN = { voiceId: "dan-id", ttsProvider: "elevenlabs-v3" as const, speaker: "Dan" }
const duo = (a: string, b: string, n = 50) => [{ speaker: a, line: "a".repeat(n) }, { speaker: b, line: "b".repeat(n) }]

describe("planVoicedDialogue", () => {
  it("a structured dialogue wins over the prompt; an empty one falls back to attributed lines in the prompt", () => {
    const fromDialogue = planVoicedDialogue({ prompt: 'Anna: "ignored"', dialogue: [{ speaker: "Anna", line: "Hello." }], characterVoices: [ANNA] })
    expect(fromDialogue.lines.map((l) => l.text)).toEqual(["Hello."])
    const fromPrompt = planVoicedDialogue({ prompt: 'Anna: "Good morning" Bob: "Morning"', dialogue: [], characterVoices: [ANNA, BOB] })
    expect(fromPrompt.lines).toHaveLength(2)
  })

  it("keeps lines in order up to the dialogue total and counts the rest as dropped — the worker's old capDialogueLines rule", () => {
    const cap = getMaxTtsChars("elevenlabs-dialogue")
    const plan = planVoicedDialogue({
      dialogue: [{ speaker: "Anna", line: "a".repeat(cap - 10) }, { speaker: "Anna", line: "b".repeat(20) }, { speaker: "Anna", line: "c" }],
      characterVoices: [ANNA],
    })
    expect(plan.lines.map((l) => l.text.length)).toEqual([cap - 10])
    expect(plan.dropped).toBe(2)
  })

  it("two resolved voices synthesise on the dialogue model; one voice on its own text-to-speech model (turbo when it names none)", () => {
    const two = planVoicedDialogue({ dialogue: [{ speaker: "Anna", line: "Hi" }, { speaker: "Bob", line: "Hey" }], characterVoices: [ANNA, BOB] })
    expect(two.multiSpeaker).toBe(true)
    expect(two.synthModel).toBe("elevenlabs-dialogue")
    const anna = planVoicedDialogue({ dialogue: [{ speaker: "Anna", line: "Hi" }], characterVoices: [ANNA] })
    expect(anna).toMatchObject({ multiSpeaker: false, synthModel: "elevenlabs-v4" })
    const bob = planVoicedDialogue({ dialogue: [{ speaker: "Bob", line: "Hi" }], characterVoices: [BOB] })
    expect(bob.synthModel).toBe("elevenlabs-turbo")
  })

  it("a multi-speaker cast synthesises on the dialogue model its voices share: v4 when every voice is on v4, v3 for a mixed cast or a voice with no model — the route's own rule (voicedDialogueProvider)", () => {
    expect(planVoicedDialogue({ dialogue: duo("Anna", "Cara"), characterVoices: [ANNA, CARA] })).toMatchObject({ multiSpeaker: true, synthModel: "elevenlabs-dialogue-v4" })
    expect(planVoicedDialogue({ dialogue: duo("Anna", "Dan"), characterVoices: [ANNA, DAN] }).synthModel).toBe("elevenlabs-dialogue") // v4 + v3
    expect(planVoicedDialogue({ dialogue: duo("Anna", "Bob"), characterVoices: [ANNA, BOB] }).synthModel).toBe("elevenlabs-dialogue") // one names no model
    expect(planVoicedDialogue({ dialogue: duo("Dan", "Bob"), characterVoices: [DAN, BOB] }).synthModel).toBe("elevenlabs-dialogue")
  })

  it("a dialogue model forwarded by the route is used as given (the worker never re-derives it); an unknown id reads as v3 dialogue", () => {
    const lines = duo("Anna", "Cara")
    expect(planVoicedDialogue({ dialogue: lines, characterVoices: [ANNA, CARA], dialogueProvider: "elevenlabs-dialogue" }).synthModel).toBe("elevenlabs-dialogue")
    expect(planVoicedDialogue({ dialogue: duo("Anna", "Bob"), characterVoices: [ANNA, BOB], dialogueProvider: "elevenlabs-dialogue-v4" }).synthModel).toBe("elevenlabs-dialogue-v4")
    expect(planVoicedDialogue({ dialogue: lines, characterVoices: [ANNA, CARA], dialogueProvider: "not-a-model" }).synthModel).toBe("elevenlabs-dialogue")
  })

  it("two voices in the cast but every line on one of them is a single-voice run (the worker's distinct-voice rule)", () => {
    const plan = planVoicedDialogue({ dialogue: [{ speaker: "Anna", line: "Hi" }, { speaker: "Anna", line: "Again" }], characterVoices: [ANNA, BOB] })
    expect(plan.multiSpeaker).toBe(false)
    expect(plan.synthModel).toBe("elevenlabs-v4")
  })

  it("non-array / non-string inputs give no lines and never throw", () => {
    for (const input of [{}, { prompt: 5, dialogue: "x", characterVoices: "y" }, { dialogue: null }]) {
      expect(planVoicedDialogue(input as never).lines).toEqual([])
    }
  })

  it("hostile entries INSIDE the arrays are skipped, never thrown on — the guard reads the body before Zod", () => {
    // A line whose text is a number, a null entry, a bare string, a voice with a numeric speaker / no voiceId.
    const hostile = {
      prompt: "she greets the room",
      dialogue: [{ speaker: "Anna", line: 5 }, null, "x", { speaker: 9, line: "Hi" }, { speaker: "Anna", line: "Kept." }],
      characterVoices: [{ voiceId: "anna-id", speaker: 7 }, null, { speaker: "Bob" }, "y"],
    }
    const plan = planVoicedDialogue(hostile as never)
    expect(plan.lines.map((l) => l.text)).toEqual(["Kept."])
    expect(plan.multiSpeaker).toBe(false)
    expect(plan.synthModel).toBe("elevenlabs-turbo") // the only usable voice names no model
    // No usable line at all → the prompt's attributed lines, here none → an empty plan.
    expect(planVoicedDialogue({ dialogue: [{ speaker: "Anna", line: 5 }, null], characterVoices: [{ voiceId: "a" }] } as never).lines).toEqual([])
  })
})

describe("voicedAddonBaseCredits", () => {
  beforeEach(() => { flag.on = true })

  it.each([
    [[ANNA], "a".repeat(1000), 40],          // sole v4 voice: 10 units × 4
    [[ANNA, BOB], "a".repeat(5000), 200],    // multi-speaker: dialogue row, 50 × 4
    [[BOB], "a".repeat(100), 16],            // sole voice, no model → turbo: 8 × 2
  ])("flag on: voices %j, %j → %i", async (voices, text, credits) => {
    const dialogue = voices.length > 1
      ? [{ speaker: "Anna", line: text.slice(0, text.length / 2) }, { speaker: "Bob", line: text.slice(text.length / 2) }]
      : [{ speaker: voices[0]!.speaker, line: text }]
    expect(await voicedAddonBaseCredits({ dialogue, characterVoices: voices })).toBe(credits)
  })

  it("counts exactly what the single-voice path sends: the lines joined by a space, [audio tags] stripped on a model that does not perform them", async () => {
    // Two 500-character lines on v4 join to 1,001 characters → 11 units × 4.
    const twoLines = [{ speaker: "Anna", line: "a".repeat(500) }, { speaker: "Anna", line: "b".repeat(500) }]
    expect(await voicedAddonBaseCredits({ dialogue: twoLines, characterVoices: [ANNA] })).toBe(44)
    // Turbo does not perform tags: the worker strips them before sending, so they are not billed.
    const tagged = "[whispers] " + "a".repeat(895)
    expect(stripAudioTags(tagged).length).toBe(895)
    expect(await voicedAddonBaseCredits({ dialogue: [{ speaker: "Bob", line: tagged }], characterVoices: [BOB] })).toBe(18) // 9 units × 2
    // v4 performs them: billed as written (906 characters → 10 units × 4).
    expect(await voicedAddonBaseCredits({ dialogue: [{ speaker: "Anna", line: tagged }], characterVoices: [ANNA] })).toBe(40)
  })

  it("a sole voice is priced on the whole joined text the worker sends — the join spaces past the model cap are billed, not clamped away", async () => {
    // Five 1,000-character lines pass the dialogue total cap (the sum is 5,000); the worker sends them
    // joined by a space — 5,004 characters on v3 (cap 5,000), which it does not clamp → 51 units × 4.
    const V3 = { voiceId: "v3-id", ttsProvider: "elevenlabs-v3" as const, speaker: "Anna" }
    const fiveLines = Array.from({ length: 5 }, () => ({ speaker: "Anna", line: "a".repeat(1000) }))
    expect(planVoicedDialogue({ dialogue: fiveLines, characterVoices: [V3] }).lines).toHaveLength(5)
    expect(await voicedAddonBaseCredits({ dialogue: fiveLines, characterVoices: [V3] })).toBe(204)
  })

  it("a hostile body prices the floor of the model it would run as and never rejects (Zod then answers 400, nothing is reserved)", async () => {
    const hostile = { dialogue: [{ speaker: "Anna", line: 5 }, null, "x"], characterVoices: [{ voiceId: "a", speaker: 7 }] }
    await expect(voicedAddonBaseCredits(hostile as never)).resolves.toBe(16) // no usable line → 8 units × turbo's 2
  })

  it("flag on: a multi-speaker cast is priced on the dialogue model it renders on — v4 on the v4 unit row, a mixed cast on v3's — floor 8 units (32), cap 5,000 (200)", async () => {
    const { getModelCreditBaseCost } = await import("@/ee/billing/credits.js")
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Cara"), characterVoices: [ANNA, CARA] })).toBe(32)
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue-v4:per-100-chars")
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Cara", 2500), characterVoices: [ANNA, CARA] })).toBe(200)
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Cara", 3500), characterVoices: [ANNA, CARA] })).toBe(140) // the plan keeps the lines that fit the 5,000 total: only the first 3,500
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Dan"), characterVoices: [ANNA, DAN] })).toBe(32)
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue:per-100-chars")
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Bob"), characterVoices: [ANNA, BOB] })).toBe(32)
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue:per-100-chars")
  })

  it("flag on: the model the route forwarded prices the add-on (worker pass-through)", async () => {
    const { getModelCreditBaseCost } = await import("@/ee/billing/credits.js")
    await voicedAddonBaseCredits({ dialogue: duo("Anna", "Cara"), characterVoices: [ANNA, CARA], dialogueProvider: "elevenlabs-dialogue" })
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue:per-100-chars")
  })

  it("flag off: today's flat dialogue row whatever the lines", async () => {
    flag.on = false
    expect(await voicedAddonBaseCredits({ dialogue: [{ speaker: "Anna", line: "a".repeat(5000) }], characterVoices: [ANNA] })).toBe(25)
    expect(await voicedAddonBaseCredits({ dialogue: [{ speaker: "Bob", line: "Hi" }], characterVoices: [BOB] })).toBe(25)
  })

  it("flag off: a v4 cast reads the v4 dialogue model's flat row (25, the same as v3) — the row the route has always reserved on", async () => {
    flag.on = false
    const { getModelCreditBaseCost } = await import("@/ee/billing/credits.js")
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Cara", 2500), characterVoices: [ANNA, CARA] })).toBe(25)
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue-v4")
    expect(await voicedAddonBaseCredits({ dialogue: duo("Anna", "Dan"), characterVoices: [ANNA, DAN] })).toBe(25)
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue")
  })

  it("names the row of the model actually synthesised", () => {
    expect(voicedAddonCreditId({ dialogue: [{ speaker: "Anna", line: "Hi" }], characterVoices: [ANNA] })).toBe("elevenlabs-v4")
    expect(voicedAddonCreditId({ dialogue: [{ speaker: "Anna", line: "Hi" }, { speaker: "Bob", line: "Yo" }], characterVoices: [ANNA, BOB] })).toBe("elevenlabs-dialogue")
    expect(voicedAddonCreditId({ dialogue: duo("Anna", "Cara"), characterVoices: [ANNA, CARA] })).toBe("elevenlabs-dialogue-v4")
  })
})
