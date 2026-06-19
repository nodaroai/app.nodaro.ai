import { describe, it, expect } from "vitest"
import {
  parseAttributedDialogue,
  resolveDialogueVoices,
  type CharacterVoiceSpec,
} from "../character-voice.js"

// Curly quotes / guillemets via code points: keeps this file ASCII and avoids
// the \uXXXX-decoding pitfall in some editors/toolchains.
const LDQUO = String.fromCharCode(0x201c)
const RDQUO = String.fromCharCode(0x201d)
const LAQUO = String.fromCharCode(0x00ab)
const RAQUO = String.fromCharCode(0x00bb)

describe("parseAttributedDialogue", () => {
  it("extracts a single straight-quoted attributed line", () => {
    expect(parseAttributedDialogue('Anna: "good morning"')).toEqual([
      { speaker: "Anna", line: "good morning" },
    ])
  })

  it("extracts multiple speakers inline, in order", () => {
    expect(
      parseAttributedDialogue('Anna: "good morning" Gordon: "good morning to you too"'),
    ).toEqual([
      { speaker: "Anna", line: "good morning" },
      { speaker: "Gordon", line: "good morning to you too" },
    ])
  })

  it("handles curly double quotes", () => {
    expect(parseAttributedDialogue(`Anna: ${LDQUO}hi there${RDQUO}`)).toEqual([
      { speaker: "Anna", line: "hi there" },
    ])
  })

  it("handles guillemets", () => {
    expect(parseAttributedDialogue(`Gordon: ${LAQUO}bonjour${RAQUO}`)).toEqual([
      { speaker: "Gordon", line: "bonjour" },
    ])
  })

  it("handles dialogue split across newlines", () => {
    expect(parseAttributedDialogue('Anna: "line one"\nGordon: "line two"')).toEqual([
      { speaker: "Anna", line: "line one" },
      { speaker: "Gordon", line: "line two" },
    ])
  })

  it("does not treat non-dialogue colon labels as speech", () => {
    expect(parseAttributedDialogue("Setting: a forest at dawn. Camera: slow dolly in.")).toEqual([])
  })

  it("extracts dialogue embedded in cinematic direction without bridging the sentence", () => {
    expect(
      parseAttributedDialogue('Wide shot of a kitchen. Anna: "where are you?" She turns.'),
    ).toEqual([{ speaker: "Anna", line: "where are you?" }])
  })

  it("supports a two-word speaker label", () => {
    expect(parseAttributedDialogue('Captain Riley: "hold the line"')).toEqual([
      { speaker: "Captain Riley", line: "hold the line" },
    ])
  })

  it("returns [] for empty input and prompts with no quoted speech", () => {
    expect(parseAttributedDialogue("")).toEqual([])
    expect(parseAttributedDialogue("a plain prompt with no dialogue at all")).toEqual([])
  })
})

describe("resolveDialogueVoices", () => {
  const anna: CharacterVoiceSpec = { voiceId: "anna-id", voiceType: "custom", speaker: "Anna" }
  const gordon: CharacterVoiceSpec = { voiceId: "gordon-id", voiceType: "premade", speaker: "Gordon" }

  it("joins each line to its speaker's voice, preserving order and voiceType", () => {
    const dialogue = [
      { speaker: "Anna", line: "good morning" },
      { speaker: "Gordon", line: "good morning to you too" },
    ]
    expect(resolveDialogueVoices(dialogue, [anna, gordon])).toEqual([
      { text: "good morning", voice: "anna-id", voiceType: "custom" },
      { text: "good morning to you too", voice: "gordon-id", voiceType: "premade" },
    ])
  })

  it("matches speaker labels case-insensitively and trimmed", () => {
    expect(resolveDialogueVoices([{ speaker: "  aNNa ", line: "hi" }], [anna])).toEqual([
      { text: "hi", voice: "anna-id", voiceType: "custom" },
    ])
  })

  it("falls back to defaultVoiceId for an unmatched speaker", () => {
    expect(
      resolveDialogueVoices(
        [{ speaker: "Stranger", line: "who are you?" }],
        [anna, gordon],
        "default-id",
      ),
    ).toEqual([{ text: "who are you?", voice: "default-id" }])
  })

  it("uses the sole voice when there is exactly one spec and no speaker match or default", () => {
    const solo: CharacterVoiceSpec = { voiceId: "solo-id", voiceType: "library" }
    expect(
      resolveDialogueVoices([{ speaker: "Narrator", line: "once upon a time" }], [solo]),
    ).toEqual([{ text: "once upon a time", voice: "solo-id", voiceType: "library" }])
  })

  it("falls back to the first voice for an unmatched speaker when several specs and no default", () => {
    expect(resolveDialogueVoices([{ speaker: "Stranger", line: "hello" }], [anna, gordon])).toEqual([
      { text: "hello", voice: "anna-id", voiceType: "custom" },
    ])
  })

  it("drops lines when there are no voices and no default", () => {
    expect(resolveDialogueVoices([{ speaker: "Anna", line: "hi" }], [])).toEqual([])
  })

  it("skips blank lines", () => {
    expect(resolveDialogueVoices([{ speaker: "Anna", line: "   " }], [anna])).toEqual([])
  })

  it("omits voiceType when the matched spec has none", () => {
    const noType: CharacterVoiceSpec = { voiceId: "x-id", speaker: "X" }
    expect(resolveDialogueVoices([{ speaker: "X", line: "yo" }], [noType])).toEqual([
      { text: "yo", voice: "x-id" },
    ])
  })
})
