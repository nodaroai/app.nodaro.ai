import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import {
  normalizeVoiceGender,
  allowedVoiceGenders,
  isVoiceGenderAllowed,
  filterVoicesByAllowedGender,
  clampLibraryGender,
  defaultAllowedVoiceId,
} from "../voice-policy.js"

// Open the d2 gate exactly as surface-profile.test.ts does: `isBusiness()`
// reads `config.EDITION` LIVE (config snapshots process.env once at import, so
// setting process.env.EDITION here would NOT re-open the gate) — mutate the
// config field instead. Only NODARO_SURFACE_PROFILE is read fresh per-call.
const withProfile = (profile: unknown, fn: () => void) => {
  const prevProfile = process.env.NODARO_SURFACE_PROFILE
  const prevEdition = config.EDITION
  config.EDITION = "business" // surfaceGateOpen() → true
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
  try {
    fn()
  } finally {
    config.EDITION = prevEdition
    if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = prevProfile
    __resetSurfaceProfileCacheForTests()
  }
}

beforeEach(() => __resetSurfaceProfileCacheForTests())
afterEach(() => __resetSurfaceProfileCacheForTests())

describe("voice-policy", () => {
  it("normalizes gender vocabulary to three tokens", () => {
    expect(normalizeVoiceGender("male")).toBe("male")
    expect(normalizeVoiceGender("female")).toBe("female")
    expect(normalizeVoiceGender("neutral")).toBe("neutral")
    expect(normalizeVoiceGender("non-binary")).toBe("neutral")
    expect(normalizeVoiceGender("")).toBe("neutral")
    expect(normalizeVoiceGender(undefined)).toBe("neutral")
  })

  it("is unrestricted by default (empty allowedGenders)", () => {
    expect(allowedVoiceGenders()).toEqual([])
    expect(isVoiceGenderAllowed("female")).toBe(true)
    expect(clampLibraryGender("female")).toBe("female")
  })

  it("enforces a male-only lock", () => {
    withProfile({ voice: { allowedGenders: ["male"] } }, () => {
      expect(allowedVoiceGenders()).toEqual(["male"])
      expect(isVoiceGenderAllowed("male")).toBe(true)
      expect(isVoiceGenderAllowed("female")).toBe(false)
      expect(isVoiceGenderAllowed("neutral")).toBe(false)
      // single allowed gender forces the outbound library query gender
      expect(clampLibraryGender("female")).toBe("male")
      expect(clampLibraryGender(undefined)).toBe("male")
      const voices = [
        { voice_id: "a", name: "Adam", gender: "male" },
        { voice_id: "r", name: "Rachel", gender: "female" },
      ]
      expect(filterVoicesByAllowedGender(voices).map((v) => v.name)).toEqual(["Adam"])
      expect(defaultAllowedVoiceId(voices, "Rachel")).toBe("Adam")
    })
  })

  it("drops a disallowed client gender to undefined when several are allowed", () => {
    withProfile({ voice: { allowedGenders: ["male", "female"] } }, () => {
      expect(clampLibraryGender("neutral")).toBeUndefined()
      expect(clampLibraryGender("male")).toBe("male")
    })
  })
})
