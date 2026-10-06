import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared"
import { hostTtsCapabilities } from "../tts-capabilities-toolkit.js"

/**
 * `providers.ttsCapabilities` — the host answers a plugin's capability question
 * from THIS app's `@nodaro/shared`, never from the plugin's own (lagging) pin.
 * The plugin validates what comes back and falls back to its local table when
 * the member is missing or the answer is malformed, so this member is
 * additive-optional and inert until a plugin reads it.
 */
describe("toolkit providers.ttsCapabilities — the host's sheet, never the plugin's", () => {
  it("answers the catalog sheet for v3 and v4, as plain copies", () => {
    for (const id of ["elevenlabs-v3", "elevenlabs-v4"]) {
      const sheet = MODEL_CATALOG[id]!.tts!
      const got = hostTtsCapabilities(id)!
      expect(got).toEqual({
        maxChars: sheet.maxChars,
        levers: [...sheet.levers],
        languages: [...sheet.languages],
        audioTags: sheet.audioTags,
      })
      // A plugin can never mutate the catalog through what it was handed.
      expect(got.languages).not.toBe(sheet.languages)
      expect(got.levers).not.toBe(sheet.levers)
    }
    expect(hostTtsCapabilities("elevenlabs-v4")).toMatchObject({ maxChars: 10000, levers: ["stability", "similarity"] })
    expect(hostTtsCapabilities("elevenlabs-v3")).toMatchObject({ maxChars: 5000, levers: ["stability"] })
  })

  it("carries exactly the four fields the plugin contract names — nothing else leaks off the sheet", () => {
    expect(Object.keys(hostTtsCapabilities("elevenlabs-v4")!).sort()).toEqual(["audioTags", "languages", "levers", "maxChars"])
  })

  it("the legacy alias reads as the model it runs as", () => {
    expect(hostTtsCapabilities("elevenlabs")).toEqual(hostTtsCapabilities("elevenlabs-turbo"))
    expect(hostTtsCapabilities("elevenlabs")).toBeDefined()
  })

  it("is undefined for an unknown id, a non-speech model, the dialogue lane and inherited member names", () => {
    for (const id of ["", "nope", "nano-banana-pro", "elevenlabs-dialogue", "constructor", "__proto__", "toString"]) {
      expect(hostTtsCapabilities(id), id).toBeUndefined()
    }
    for (const id of [["elevenlabs-v4"], 4, null, undefined, {}] as unknown as string[]) {
      expect(hostTtsCapabilities(id)).toBeUndefined()
    }
  })
})
