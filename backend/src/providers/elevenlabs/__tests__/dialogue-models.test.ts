import { describe, it, expect } from "vitest"
import { DIALOGUE_PROVIDERS, DEFAULT_DIALOGUE_PROVIDER, TTS_PROVIDERS } from "@nodaro/shared"
import { DIALOGUE_WIRE_MODELS, dialogueWireModel, dialogueModelKey, dialogueSpeechModel } from "../dialogue-models.js"
import { TTS_WIRE_MODELS } from "../tts-models.js"

describe("dialogue wire models", () => {
  it("has exactly one row per dialogue provider", () => {
    expect(Object.keys(DIALOGUE_WIRE_MODELS).sort()).toEqual([...DIALOGUE_PROVIDERS].sort())
  })

  it("each row's speech model is a live text-to-speech provider on the same ElevenLabs model", () => {
    for (const [id, row] of Object.entries(DIALOGUE_WIRE_MODELS)) {
      expect(TTS_PROVIDERS as readonly string[], id).toContain(row.speechModel)
      expect(TTS_WIRE_MODELS[row.speechModel], id).toBe(row.wire)
    }
  })

  it("v3 dialogue runs on eleven_v3, keyed and billed as itself", () => {
    expect(dialogueWireModel("elevenlabs-dialogue")).toBe("eleven_v3")
    expect(dialogueModelKey("elevenlabs-dialogue")).toBe("elevenlabs-dialogue")
    expect(dialogueSpeechModel("elevenlabs-dialogue")).toBe("elevenlabs-v3")
  })

  it("v4 dialogue runs on eleven_v4, keyed and billed as itself, sharing v4 speech's voices", () => {
    expect(dialogueWireModel("elevenlabs-dialogue-v4")).toBe("eleven_v4")
    expect(dialogueModelKey("elevenlabs-dialogue-v4")).toBe("elevenlabs-dialogue-v4")
    expect(dialogueSpeechModel("elevenlabs-dialogue-v4")).toBe("elevenlabs-v4")
  })

  it("a missing, unknown, inherited-member, non-string or text-to-speech id runs as the default", () => {
    for (const id of [undefined, "", "nope", "constructor", "__proto__", ["elevenlabs-dialogue"], "elevenlabs-v4"] as unknown[]) {
      expect(dialogueWireModel(id), JSON.stringify(id)).toBe(DIALOGUE_WIRE_MODELS[DEFAULT_DIALOGUE_PROVIDER].wire)
      expect(dialogueModelKey(id), JSON.stringify(id)).toBe(DEFAULT_DIALOGUE_PROVIDER)
    }
  })
})
