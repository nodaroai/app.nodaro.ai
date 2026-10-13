/**
 * The worked examples in the public speech docs are computed by the formula,
 * not typed: each line here is a sentence the doc must contain, priced as the
 * formula's unit count of its row (the `<row>@<units>` annotation the figure
 * carries). docs-charged-prices.test.ts holds every annotated figure to the
 * charged price; this suite holds the units to the formula. Change one, and
 * the other fails until it follows.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { speechCredits, SPEECH_FLOOR_UNITS } from "@nodaro/shared"

const DOCS = join(__dirname, "..", "..", "..", "..", "docs/nodes")
const tts = readFileSync(join(DOCS, "ai-audio/text-to-speech.md"), "utf8")
const dialogue = readFileSync(join(DOCS, "ai-audio/text-to-dialogue.md"), "utf8")
const generateVideo = readFileSync(join(DOCS, "ai-video/generate-video.md"), "utf8")
const voiceChangerPro = readFileSync(join(DOCS, "ai-audio/voice-changer-pro.md"), "utf8")
const sdkReference = readFileSync(join(DOCS, "..", "sdk-reference.md"), "utf8")

/** The units of a request of `chars` characters: `speechCredits` at one credit a unit. */
const unitsOf = (chars: number) => speechCredits(chars, 1)
/** A line of `doc` that holds `sentence` and prices it as `units` of `row` (a charge, or a `credits-rate` share). */
const linePricing = (doc: string, sentence: string, row: string, units: number, kind: "credits" | "credits-rate" = "credits") =>
  doc.split("\n").some((line) => line.includes(sentence) && line.includes(`<!-- ${kind}: ${row}@${units} -->`))

describe("text-to-speech.md Credits", () => {
  it.each([
    ["100 characters on v4", 100, "elevenlabs-v4:per-100-chars"],
    ["1,000 characters on v3", 1000, "elevenlabs-v3:per-100-chars"],
    ["10,000 characters on v4", 10000, "elevenlabs-v4:per-100-chars"],
    ["10,000 characters on v4", 10000, "elevenlabs-turbo:per-100-chars"],
    ["2,500 characters on v4 Turbo", 2500, "elevenlabs-v4-turbo:per-100-chars"],
  ])("%s (%s)", (label, chars, row) => {
    expect(linePricing(tts, `**${label}**`, row, unitsOf(chars)), `${label} priced as ${unitsOf(chars)} units of ${row}`).toBe(true)
  })

  it("states the minimum, the unit table and the live-everywhere note with the flag-off fallback", () => {
    expect(tts).toContain(`minimum of ${SPEECH_FLOOR_UNITS} units per request`)
    expect(tts).toContain("credits = ceil(max(8, ceil(characters / 100)) × unit)")
    for (const [label, row] of [
      ["| ElevenLabs v4, v3, Multilingual v2 |", "elevenlabs-v4:per-100-chars"],
      ["| Turbo v2.5 (and the legacy `elevenlabs` id, which runs as Turbo) |", "elevenlabs-turbo:per-100-chars"],
      ["| v4 Turbo |", "elevenlabs-v4-turbo:per-100-chars"],
    ] as const) {
      expect(linePricing(tts, label, row, SPEECH_FLOOR_UNITS), label).toBe(true)
      expect(tts).toContain(`<!-- credits-rate: ${row} -->`)
    }
    // The flag has been on in production since 2026-10-08; the note states that and keeps the flag-off fallback.
    expect(tts).toContain("Length-based pricing is on at `app.nodaro.ai` and `next.nodaro.ai`")
    expect(tts).toContain("leaves `SPEECH_LENGTH_PRICING_ENABLED` off instead charges the flat amount")
    expect(tts).not.toContain("Rolling out")
  })

  it("states that every estimate surface reads the same rows (Phase 1b), and no longer defers it to a following release", () => {
    expect(tts).toContain("The editor's price badge, the workflow estimate and a published app's advertised price read the same rows")
    expect(tts).toContain("priced at its text input's character limit when the app sets one, else at the cap")
    expect(tts).toContain("follow the same switch: the flat amount where length pricing is off, the length price where it is on")
    expect(tts).not.toContain("following release")
    expect(dialogue).toContain("The editor's estimate, a published app's advertised price and the credits reserved when the node runs all read the same rows")
  })
})

describe("text-to-dialogue.md Credits", () => {
  it.each([
    [100, "**100 characters** (any script up to 800) → **", "elevenlabs-dialogue:per-100-chars"],
    [1000, "**1,000 characters** → **", "elevenlabs-dialogue:per-100-chars"],
    [5000, "**5,000 characters** (Dialogue v3's cap) → **", "elevenlabs-dialogue:per-100-chars"],
    [10000, "**10,000 characters** (Dialogue v4's cap) → **", "elevenlabs-dialogue-v4:per-100-chars"],
  ])("%i characters", (chars, sentence, row) => {
    expect(dialogue).toContain(sentence)
    expect(dialogue).toContain(`<!-- credits: ${row}@${unitsOf(chars)} -->`)
  })
})

describe("voice-changer-pro.md Credit Pricing — a Re-speak voice on the engine's speech unit row (D-VCP)", () => {
  it.each([
    [340, "| 1 Re-speak voice of 340 characters (either engine) |"],
    [1000, "| 1 Re-speak voice of 1,000 characters |"],
    [1001, "| 1 Re-speak voice of 1,001 characters |"],
    [5000, "| 1 Re-speak voice of 5,000 characters |"],
  ])("%i characters", (chars, row) => {
    expect(linePricing(voiceChangerPro, row, "elevenlabs-v3:per-100-chars", unitsOf(chars))).toBe(true)
  })

  it("prices a mixed recast as one charge: the stems and the Re-speak voice's units together", () => {
    expect(voiceChangerPro).toContain(
      `| 2 speech-to-speech voices at 60 s + 1 Re-speak voice of 1,500 characters |`,
    )
    expect(voiceChangerPro).toContain(`<!-- credits: (voice-changer-pro@2 + elevenlabs-v3:per-100-chars@${unitsOf(1500)}) -->`)
  })

  it("states the Text to Speech parity, the minimum, the formula, the live-everywhere note with the flag-off price, and the blind-caller ceiling", () => {
    expect(voiceChangerPro).toContain("costs **exactly what the same\ntext costs on the [Text to Speech](./text-to-speech.md) node for the same\nmodel**")
    expect(voiceChangerPro).toContain(`minimum of ${SPEECH_FLOOR_UNITS}\nunits per voice`)
    expect(voiceChangerPro).toContain("re-speak voice = max(8, ceil(chars / 100)) × 4.4")
    expect(voiceChangerPro).toContain("Length-based speech pricing is on at `app.nodaro.ai` and `next.nodaro.ai`")
    expect(voiceChangerPro).not.toContain("Rolling out")
    expect(voiceChangerPro).toMatch(/340 characters cost \d+<!-- credits: voice-changer-pro-respeak -->, 1,500 cost \d+<!-- credits: voice-changer-pro-respeak@2 -->/)
    expect(voiceChangerPro).toContain("1,000 characters per Re-speak voice")
    // The flag-off numbers the note quotes are today's formula: max(4, ceil(chars / 1000) × 30).
    expect(Math.max(4, Math.ceil(340 / 1000) * 30)).toBe(30)
    expect(Math.max(4, Math.ceil(1500 / 1000) * 30)).toBe(60)
    // The sentence that priced both engines per started 1K as the only rule is gone from the config table and the SDK reference.
    expect(voiceChangerPro).not.toContain("Both Re-speak engines are priced the same")
    expect(sdkReference).not.toContain("Both Re-speak engines are priced the same")
    expect(sdkReference).toContain("on its engine's Text to Speech rate (per started 100")
  })
})

describe("generate-video.md Credit pricing (character voice) — the audio_driven add-on row", () => {
  it.each([
    [800, "elevenlabs-v4:per-100-chars", "1–800 characters add "],
    [5000, "elevenlabs-v4:per-100-chars", "5,000 add "],
    [10000, "elevenlabs-v4:per-100-chars", "10,000 on Dialogue v4 add "],
    // A single cast voice on Turbo v2.5 or on v4 Turbo is priced on that model's own unit row (speechRunsAs keeps the id).
    [800, "elevenlabs-v4-turbo:per-100-chars", "2.2"],
    [5000, "elevenlabs-v4-turbo:per-100-chars", "2.2"],
  ])("%i characters on %s", (chars, row, sentence) => {
    expect(linePricing(generateVideo, sentence, row, unitsOf(chars), "credits-rate")).toBe(true)
  })

  it("names the model actually synthesised, the minimum, the by-length row and the flag-off fallback", () => {
    expect(generateVideo).toContain("`elevenlabs-dialogue-v4` for a multi-voice cast whose every voice is on `elevenlabs-v4`, `elevenlabs-dialogue` for any other multi-voice cast, else the voice's own text-to-speech model")
    expect(generateVideo).toContain(`at least ${SPEECH_FLOOR_UNITS} units`)
    // A single voice's lines are priced joined by a space, as the worker sends them (voicedAddonBaseCredits).
    expect(generateVideo).toContain("counted joined by a space, as they are sent")
    expect(generateVideo).toContain("By length — every started 100 characters")
    expect(generateVideo).toMatch(/Where a Cloud-edition install leaves `SPEECH_LENGTH_PRICING_ENABLED` off: a flat [\d.]+<!-- credits-rate: elevenlabs-dialogue -->/)
    expect(generateVideo).not.toContain("Rolling out")
    // The old row said "per 1K chars" for what was a flat price — gone.
    expect(generateVideo).not.toContain("per 1K chars")
  })
})
