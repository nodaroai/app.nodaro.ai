/**
 * One character count for every speech seam: what the worker SENDS — clamped
 * to the cap of the model the request runs as (the route clamps first,
 * text-to-speech.ts), then stripped of [audio tags] when that model does not
 * perform them (the worker strips after, audio-ai.ts). Dialogue is the sum of
 * line texts, unstripped. Anything that is not text counts 0 → the floor.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ELEVENLABS_API_KEY: "k" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: vi.fn(async (id: string) => ({
    creditCost: id === "elevenlabs-turbo:per-100-chars" ? 2 : id.endsWith(":per-100-chars") ? 4 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))

import { getMaxTtsChars, SPEECH_FLOOR_UNITS } from "@nodaro/shared"
import { stripAudioTags } from "../../providers/elevenlabs/audio-tags.js"
import {
  speechRunsAs, billableSpeechChars, billableDialogueChars, speechBaseCredits, dialogueBaseCredits,
} from "../speech-credits.js"

describe("speechRunsAs", () => {
  it.each([
    ["elevenlabs-v3", "elevenlabs-v3"],
    ["elevenlabs-v4", "elevenlabs-v4"],
    ["elevenlabs", "elevenlabs-turbo"],
    ["not-a-model", "elevenlabs-turbo"],
    ["constructor", "elevenlabs-turbo"],
    [undefined, "elevenlabs-turbo"],
    [["elevenlabs-v3"], "elevenlabs-turbo"],
    ["", "elevenlabs-turbo"],
  ])("%j runs as %s", (provider, runsAs) => {
    expect(speechRunsAs(provider)).toBe(runsAs)
  })
})

describe("billableSpeechChars", () => {
  it("counts UTF-16 code units of the text as sent", () => {
    expect(billableSpeechChars("elevenlabs-v4", "Hello")).toBe(5)
    expect(billableSpeechChars("elevenlabs-v4", "😀")).toBe(2) // an astral character counts 2 — the safe direction
  })

  it("clamps to the cap of the model the request runs as, like the route does", () => {
    expect(billableSpeechChars("elevenlabs-v3", "a".repeat(6000))).toBe(getMaxTtsChars("elevenlabs-v3"))
    expect(billableSpeechChars("elevenlabs-v4", "a".repeat(12000))).toBe(10000)
    // The alias runs as turbo (cap 40,000) — never getMaxTtsChars("elevenlabs")'s 5,000 default.
    expect(billableSpeechChars("elevenlabs", "a".repeat(12000))).toBe(12000)
    expect(billableSpeechChars("elevenlabs-turbo", "a".repeat(45000))).toBe(40000)
  })

  it("strips [audio tags] on a model that does not perform them, after the clamp — exactly what the worker sends", () => {
    const text = "[whispers] Hello there [laughs] friend"
    expect(billableSpeechChars("elevenlabs-turbo", text)).toBe(stripAudioTags(text).length)
    expect(billableSpeechChars("elevenlabs-multilingual", text)).toBe(stripAudioTags(text).length)
    expect(billableSpeechChars("elevenlabs-v3", text)).toBe(text.length)
    expect(billableSpeechChars("elevenlabs-v4", text)).toBe(text.length)
    // Clamp first: a tag that straddles the cap is cut, then whatever is left is stripped.
    const long = "a".repeat(39_990) + "[laughs] tail"
    expect(billableSpeechChars("elevenlabs-turbo", long)).toBe(stripAudioTags(long.slice(0, 40_000)).length)
  })

  it("anything that is not text counts 0", () => {
    for (const bad of [undefined, null, 42, ["a"], { text: "a" }, true]) {
      expect(billableSpeechChars("elevenlabs-v4", bad), JSON.stringify(bad)).toBe(0)
    }
  })
})

describe("billableDialogueChars", () => {
  it("sums the line texts, unstripped (v3 performs tags), capped at the dialogue total", () => {
    expect(billableDialogueChars([{ text: "Hi.", voice: "Rachel" }, { text: "[laughs] Hello!", voice: "George" }])).toBe(3 + 15)
    expect(billableDialogueChars([{ text: "a".repeat(6000), voice: "Rachel" }])).toBe(getMaxTtsChars("elevenlabs-dialogue"))
  })

  it("skips lines whose text is not a string; anything that is not an array counts 0", () => {
    expect(billableDialogueChars([{ text: "Hi", voice: "R" }, { text: 7, voice: "R" }, null])).toBe(2)
    for (const bad of [undefined, "Hi", 3, { dialogue: [] }]) expect(billableDialogueChars(bad), JSON.stringify(bad)).toBe(0)
  })
})

describe("base credits — the formula on the model's :per-100-chars row", () => {
  it.each([
    ["elevenlabs-v4", "a".repeat(100), 32],
    ["elevenlabs-v4", "a".repeat(801), 36],
    ["elevenlabs-v3", "a".repeat(5000), 200],
    ["elevenlabs-v3", "a".repeat(6000), 200], // clamped, then priced
    ["elevenlabs-turbo", "a".repeat(100), 16],
    ["elevenlabs", "a".repeat(1000), 20], // alias → turbo's row
    ["elevenlabs-turbo", "a".repeat(40000), 800],
  ])("%s with %j → %i", async (provider, text, credits) => {
    expect(await speechBaseCredits(provider, text)).toBe(credits)
  })

  it("a non-string text is the floor on the model's row", async () => {
    expect(await speechBaseCredits("elevenlabs-v4", 42)).toBe(SPEECH_FLOOR_UNITS * 4)
    expect(await speechBaseCredits("elevenlabs-turbo", undefined)).toBe(SPEECH_FLOOR_UNITS * 2)
  })

  it("dialogue prices the sum of its lines on the dialogue unit row", async () => {
    expect(await dialogueBaseCredits([{ text: "a".repeat(100), voice: "R" }])).toBe(32)
    expect(await dialogueBaseCredits([{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }])).toBe(200)
    expect(await dialogueBaseCredits("not lines")).toBe(32)
  })

  it("dialogue takes the model as a parameter, resolved like the route and the payload builder: an unknown id prices on the default dialogue row, never another lane's", async () => {
    // The mocked row reader answers 4 for any `:per-100-chars` id — this pins which id is read.
    const { getModelCreditBaseCost } = await import("../../ee/billing/credits.js")
    await dialogueBaseCredits([{ text: "a", voice: "R" }], "not-a-dialogue-model")
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue:per-100-chars")
    await dialogueBaseCredits([{ text: "a", voice: "R" }], "elevenlabs-dialogue")
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue:per-100-chars")
  })

  it("v4 dialogue prices on ITS OWN unit row, at the same floor of 8 units (32) and the same per-100 rate as v3 dialogue", async () => {
    const { getModelCreditBaseCost } = await import("../../ee/billing/credits.js")
    expect(await dialogueBaseCredits([{ text: "a".repeat(100), voice: "R" }], "elevenlabs-dialogue-v4")).toBe(32)
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue-v4:per-100-chars")
    expect(await dialogueBaseCredits([{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }], "elevenlabs-dialogue-v4")).toBe(200)
    expect(await dialogueBaseCredits([{ text: "a".repeat(9000), voice: "R" }], "elevenlabs-dialogue-v4")).toBe(200) // the total cap, 5,000
  })
})
