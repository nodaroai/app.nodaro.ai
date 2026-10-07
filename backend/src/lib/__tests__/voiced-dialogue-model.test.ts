import { describe, it, expect } from "vitest"
import { voicedDialogueProvider } from "../voiced-dialogue-model.js"

describe("voicedDialogueProvider — the dialogue model a voiced cast runs on", () => {
  it("every voice on v4 → v4 dialogue", () => {
    expect(voicedDialogueProvider([{ ttsProvider: "elevenlabs-v4" }, { ttsProvider: "elevenlabs-v4" }])).toBe("elevenlabs-dialogue-v4")
  })

  it("every voice on v3 → v3 dialogue", () => {
    expect(voicedDialogueProvider([{ ttsProvider: "elevenlabs-v3" }, { ttsProvider: "elevenlabs-v3" }])).toBe("elevenlabs-dialogue")
  })

  it("a mixed cast, a voice with no model, a model with no dialogue twin, or no voices → v3 dialogue (the default)", () => {
    expect(voicedDialogueProvider([{ ttsProvider: "elevenlabs-v4" }, { ttsProvider: "elevenlabs-v3" }])).toBe("elevenlabs-dialogue")
    expect(voicedDialogueProvider([{ ttsProvider: "elevenlabs-v4" }, {}])).toBe("elevenlabs-dialogue")
    expect(voicedDialogueProvider([{ ttsProvider: "elevenlabs-turbo" }, { ttsProvider: "elevenlabs-turbo" }])).toBe("elevenlabs-dialogue")
    expect(voicedDialogueProvider([])).toBe("elevenlabs-dialogue")
    expect(voicedDialogueProvider(undefined)).toBe("elevenlabs-dialogue")
  })

  it("the legacy alias reads as the model it runs as (turbo — no twin)", () => {
    expect(voicedDialogueProvider([{ ttsProvider: "elevenlabs" }, { ttsProvider: "elevenlabs" }])).toBe("elevenlabs-dialogue")
  })

  it("a non-string or inherited-member model is a voice with no model", () => {
    expect(voicedDialogueProvider([{ ttsProvider: ["elevenlabs-v4"] as unknown as string }, { ttsProvider: "elevenlabs-v4" }])).toBe("elevenlabs-dialogue")
    expect(voicedDialogueProvider([{ ttsProvider: "constructor" }, { ttsProvider: "constructor" }])).toBe("elevenlabs-dialogue")
  })

  it("a voice that is not an object (the credit resolver reads the RAW body, before Zod) is a voice with no model — never a throw", () => {
    const raw = (voices: unknown[]) => voicedDialogueProvider(voices as ReadonlyArray<{ ttsProvider?: unknown }>)
    expect(raw([null])).toBe("elevenlabs-dialogue")
    expect(raw(["Rachel", { ttsProvider: "elevenlabs-v4" }])).toBe("elevenlabs-dialogue")
    expect(raw([{ ttsProvider: "elevenlabs-v4" }, undefined])).toBe("elevenlabs-dialogue")
    expect(raw([42])).toBe("elevenlabs-dialogue")
  })
})
