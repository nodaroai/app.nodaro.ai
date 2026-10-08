import { describe, it, expect } from "vitest"
import { ttsSupportsStitching } from "@nodaro/shared"
import { ttsModelSwitchPatch } from "../tts-model-switch"

describe("ttsModelSwitchPatch — what a user's model switch clears", () => {
  const tuned = { similarityBoost: 0.8, style: 0.3, speed: 1.15, languageCode: "he" }

  it("to v3: similarity, style and speed go; Hebrew stays (v3 offers it)", () => {
    const patch = ttsModelSwitchPatch("elevenlabs-v3", tuned)
    expect(patch).toStrictEqual({ similarityBoost: undefined, style: undefined, speed: undefined })
    // toStrictEqual distinguishes an explicit `undefined` from an absent key, and the store
    // only REMOVES a stored value when the patch carries its key.
    expect(Object.keys(patch).sort()).toEqual(["similarityBoost", "speed", "style"])
  })

  it("to v4: speed and style go, similarity stays (v4 honours it), Hebrew stays", () => {
    const patch = ttsModelSwitchPatch("elevenlabs-v4", tuned)
    expect(patch).toStrictEqual({ style: undefined, speed: undefined })
    expect(Object.keys(patch).sort()).toEqual(["speed", "style"])
  })

  it("to v4 Turbo: speed and style go, similarity stays, Hebrew stays — exactly as to v4", () => {
    expect(ttsModelSwitchPatch("elevenlabs-v4-turbo", tuned)).toStrictEqual(ttsModelSwitchPatch("elevenlabs-v4", tuned))
  })

  it("to turbo: every lever stays, but Hebrew is not offered, so the language resets to auto-detect", () => {
    expect(ttsModelSwitchPatch("elevenlabs-turbo", tuned)).toStrictEqual({ languageCode: "" })
  })

  it("to multilingual: every lever stays; Hebrew is not offered", () => {
    expect(ttsModelSwitchPatch("elevenlabs-multilingual", tuned)).toStrictEqual({ languageCode: "" })
  })

  it("a node that already fits the model yields an empty patch — nothing to write, nothing to mark dirty", () => {
    expect(ttsModelSwitchPatch("elevenlabs-v3", {})).toStrictEqual({})
    expect(ttsModelSwitchPatch("elevenlabs-v3", { languageCode: "" })).toStrictEqual({})
    expect(ttsModelSwitchPatch("elevenlabs-turbo", { similarityBoost: 0.75, style: 0, speed: 1, languageCode: "en" })).toStrictEqual({})
  })

  it("clears only what the node actually carries", () => {
    expect(ttsModelSwitchPatch("elevenlabs-v3", { speed: 1 })).toStrictEqual({ speed: undefined })
    expect(ttsModelSwitchPatch("elevenlabs-v4", { speed: 1, similarityBoost: 0.5 })).toStrictEqual({ speed: undefined })
  })

  it("a switch to the legacy alias, an unknown id or a missing id reads as turbo", () => {
    for (const next of ["elevenlabs", "not-a-model", "elevenlabs-dialogue", "constructor"]) {
      expect(ttsModelSwitchPatch(next, tuned), next).toStrictEqual({ languageCode: "" })
    }
  })

  describe("neighbour text (continuity)", () => {
    const withContext = { previousText: "Before.", nextText: "After." }

    it("to a model that does not stitch (v3): both are reset to empty, in the same patch as the levers", () => {
      const patch = ttsModelSwitchPatch("elevenlabs-v3", { ...tuned, ...withContext })
      expect(patch).toStrictEqual({ similarityBoost: undefined, style: undefined, speed: undefined, previousText: "", nextText: "" })
    })

    it("to v4: both stay", () => {
      expect(ttsModelSwitchPatch("elevenlabs-v4", withContext)).toStrictEqual({})
    })

    it("to v4 Turbo: both stay iff its sheet stitches", () => {
      const patch = ttsModelSwitchPatch("elevenlabs-v4-turbo", withContext)
      expect(patch).toStrictEqual(ttsSupportsStitching("elevenlabs-v4-turbo") ? {} : { previousText: "", nextText: "" })
    })

    it("clears only a side the node actually carries, and never an already-empty one", () => {
      expect(ttsModelSwitchPatch("elevenlabs-v3", { previousText: "Before." })).toStrictEqual({ previousText: "" })
      expect(ttsModelSwitchPatch("elevenlabs-v3", { previousText: "", nextText: "" })).toStrictEqual({})
      expect(ttsModelSwitchPatch("elevenlabs-v3", {})).toStrictEqual({})
    })
  })
})
