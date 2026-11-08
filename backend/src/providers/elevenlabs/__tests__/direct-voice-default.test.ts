/**
 * The voice a speech request sends when it names none (`resolveDirectVoiceId`,
 * the one name → id step every ElevenLabs funnel takes: text-to-speech,
 * dialogue lines and the voice changer's target). The voice lock judges a
 * named voice and leaves an empty one to "the policy's own default voice", so
 * this default must BE the policy's: the first allowed-gender voice under a
 * lock. It used to be Rachel on every deployment, so an empty voice changer
 * target spoke in a female voice on a male-only deployment.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const gate = vi.hoisted(() => ({ open: false }))
vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
  isBusiness: () => gate.open,
  isCloud: () => false,
}))

import { resolveDirectVoiceId } from "../direct-tts.js"
import { PREMADE_VOICE_IDS } from "../../../lib/premade-voices.js"
import { premadeCatalogGender } from "../../../lib/voice-policy.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

function lock(allowedGenders: string[]): void {
  gate.open = true
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders } })
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  gate.open = false
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("resolveDirectVoiceId — the voice an unnamed voice becomes", () => {
  it("is Rachel's id with no lock, for undefined and the empty string alike (unchanged)", () => {
    expect(resolveDirectVoiceId(undefined)).toBe(PREMADE_VOICE_IDS.Rachel)
    expect(resolveDirectVoiceId("")).toBe(PREMADE_VOICE_IDS.Rachel)
  })

  it.each([
    [["male"], "male"],
    [["female"], "female"],
    [["neutral"], "neutral"],
  ] as const)("under a %j lock is a premade voice of an allowed gender", (allowed, gender) => {
    lock([...allowed])
    for (const empty of [undefined, ""]) {
      const id = resolveDirectVoiceId(empty)
      expect(premadeCatalogGender(id), `default voice ${id}`).toBe(gender)
    }
  })

  it("leaves a named voice alone under a lock (judging it is the lock's job, upstream)", () => {
    lock(["male"])
    expect(resolveDirectVoiceId("Rachel")).toBe(PREMADE_VOICE_IDS.Rachel)
    expect(resolveDirectVoiceId("W3C2vBPukr5b5jvoXhPK")).toBe("W3C2vBPukr5b5jvoXhPK")
  })
})
