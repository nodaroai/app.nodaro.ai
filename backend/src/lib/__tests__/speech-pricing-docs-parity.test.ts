/**
 * The worked examples in the public speech docs are computed by the formula,
 * not typed: each line here is a sentence the doc must contain AND a case the
 * formula must give. Change one, and the other fails until it follows.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { speechCredits, SPEECH_FLOOR_UNITS } from "@nodaro/shared"

const DOCS = join(__dirname, "..", "..", "..", "..", "docs/nodes")
const tts = readFileSync(join(DOCS, "ai-audio/text-to-speech.md"), "utf8")
const dialogue = readFileSync(join(DOCS, "ai-audio/text-to-dialogue.md"), "utf8")
const generateVideo = readFileSync(join(DOCS, "ai-video/generate-video.md"), "utf8")

describe("text-to-speech.md Credits", () => {
  it.each([
    ["100 characters on v4", 100, 4, 32, "8 × 4 = **32 credits**"],
    ["1,000 characters on v3", 1000, 4, 40, "10 × 4 = **40 credits**"],
    ["10,000 characters on v4", 10000, 4, 400, "**400 credits**"],
    ["10,000 characters on Turbo", 10000, 2, 200, "100 × 2 = **200 credits**"],
  ])("%s", (_label, chars, unit, credits, sentence) => {
    expect(speechCredits(chars, unit)).toBe(credits)
    expect(tts).toContain(sentence)
  })

  it("states the minimum, the unit table and the rolling-out note", () => {
    expect(tts).toContain(`minimum of ${SPEECH_FLOOR_UNITS} units per request`)
    expect(tts).toContain("| ElevenLabs v4, v3, Multilingual v2 | 4 | 32 |")
    expect(tts).toContain("| Turbo v2.5 (and the legacy `elevenlabs` id, which runs as Turbo) | 2 | 16 |")
    expect(tts).toContain("**Rolling out.**")
  })
})

describe("text-to-dialogue.md Credits", () => {
  it.each([[100, 32, "**100 characters** (any script up to 800) → **32 credits**"], [1000, 40, "**1,000 characters** → **40 credits**"], [5000, 200, "**5,000 characters** (the cap) → **200 credits**"]])(
    "%i characters → %i", (chars, credits, sentence) => {
      expect(speechCredits(chars, 4)).toBe(credits)
      expect(dialogue).toContain(sentence)
    },
  )
})

describe("generate-video.md Credit pricing (character voice) — the audio_driven add-on row", () => {
  it.each([
    [800, 4, 32, "1–800 characters cost 32"],
    [5000, 4, 200, "5,000 cost 200"],
    [800, 2, 16, "2 on Turbo v2.5 (16 and 100)"],
    [5000, 2, 100, "2 on Turbo v2.5 (16 and 100)"],
  ])("%i characters at %i per unit → %i", (chars, unit, credits, sentence) => {
    expect(speechCredits(chars, unit)).toBe(credits)
    expect(generateVideo).toContain(sentence)
  })

  it("names the model actually synthesised, the minimum, the rolling-out note and today's flat row", () => {
    expect(generateVideo).toContain("`elevenlabs-dialogue-v4` for a multi-voice cast whose every voice is on `elevenlabs-v4`, `elevenlabs-dialogue` for any other multi-voice cast, else the voice's own text-to-speech model")
    expect(generateVideo).toContain(`at least ${SPEECH_FLOOR_UNITS} units`)
    // A single voice's lines are priced joined by a space, as the worker sends them (voicedAddonBaseCredits).
    expect(generateVideo).toContain("counted joined by a space, as they are sent")
    expect(generateVideo).toContain("Rolling out: by length")
    expect(generateVideo).toContain("Until the rollout reaches your instance: a flat 25")
    // The old row said "per 1K chars" for what was a flat price — gone.
    expect(generateVideo).not.toContain("per 1K chars")
  })
})
