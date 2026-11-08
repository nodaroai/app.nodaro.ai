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
  knownVoiceGender,
  voiceLockActive,
  premadeCatalogGender,
  judgeResolvedVoices,
  type VoiceGender,
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

describe("voice-policy — an unknown gender is not a neutral one", () => {
  it("knownVoiceGender keeps a missing or unrecognised label apart from neutral", () => {
    expect(knownVoiceGender("Male ")).toBe("male")
    expect(knownVoiceGender("female")).toBe("female")
    expect(knownVoiceGender("neutral")).toBe("neutral")
    expect(knownVoiceGender("non-binary")).toBe("neutral")
    expect(knownVoiceGender("")).toBeUndefined()
    expect(knownVoiceGender(undefined)).toBeUndefined()
    expect(knownVoiceGender(null)).toBeUndefined()
    expect(knownVoiceGender("robot")).toBeUndefined()
  })

  it("under a lock that allows neutral, a voice with no gender is still not listed", () => {
    withProfile({ voice: { allowedGenders: ["male", "neutral"] } }, () => {
      const voices = [
        { voice_id: "a", name: "Adam", gender: "male" },
        { voice_id: "r", name: "River", gender: "neutral" },
        { voice_id: "x", name: "Unlabelled", gender: "" },
        { voice_id: "y", name: "NoField" },
      ]
      expect(filterVoicesByAllowedGender(voices).map((v) => v.name)).toEqual(["Adam", "River"])
      expect(isVoiceGenderAllowed("")).toBe(false)
      expect(isVoiceGenderAllowed("neutral")).toBe(true)
      expect(voiceLockActive()).toBe(true)
    })
  })

  it("lists every voice, labelled or not, when unrestricted", () => {
    const voices = [{ voice_id: "x", name: "Unlabelled", gender: "" }, { voice_id: "y", name: "NoField" }]
    expect(filterVoicesByAllowedGender(voices)).toEqual(voices)
    expect(voiceLockActive()).toBe(false)
  })
})

describe("voice-policy — the premade catalog by name AND by voice id", () => {
  it("knows a premade voice by its name and by its ElevenLabs id", () => {
    expect(premadeCatalogGender("Rachel")).toBe("female")
    expect(premadeCatalogGender("21m00Tcm4TlvDq8ikWAM")).toBe("female") // Rachel's id
    expect(premadeCatalogGender("Brian")).toBe("male")
    expect(premadeCatalogGender("nPczCjzI2devNBz1zQrb")).toBe("male") // Brian's id
    expect(premadeCatalogGender("pNInz6obpgDQGcFmaJgB")).toBe("male") // Adam, whose catalog id IS its uuid
    expect(premadeCatalogGender("River")).toBe("neutral")
  })

  it("knows nothing about a voice that is not premade", () => {
    expect(premadeCatalogGender("W3C2vBPukr5b5jvoXhPK")).toBeUndefined()
    expect(premadeCatalogGender("")).toBeUndefined()
  })
})

describe("voice-policy — the synchronous backstop fails closed", () => {
  it("allows everything, resolved or not, when unrestricted", () => {
    expect(judgeResolvedVoices(["Rachel", "W3C2vBPukr5b5jvoXhPK"], undefined)).toEqual({ allowed: true })
  })

  it("under a lock, judges a premade voice from the catalog even with nothing resolved", () => {
    withProfile({ voice: { allowedGenders: ["male"] } }, () => {
      expect(judgeResolvedVoices(["Adam"], undefined)).toEqual({ allowed: true })
      expect(judgeResolvedVoices(["21m00Tcm4TlvDq8ikWAM"], undefined)).toEqual({ allowed: false, reason: "gender_not_allowed" })
    })
  })

  it("under a lock, refuses a voice nobody resolved (a caller that skipped the lookup fails closed)", () => {
    withProfile({ voice: { allowedGenders: ["male"] } }, () => {
      expect(judgeResolvedVoices(["W3C2vBPukr5b5jvoXhPK"], undefined)).toEqual({ allowed: false, reason: "gender_unknown" })
      expect(judgeResolvedVoices(["W3C2vBPukr5b5jvoXhPK"], new Map())).toEqual({ allowed: false, reason: "gender_unknown" })
    })
  })

  it("under a lock, takes what the caller resolved, and refuses a resolved unknown or disallowed gender", () => {
    withProfile({ voice: { allowedGenders: ["male"] } }, () => {
      const resolved = new Map<string, VoiceGender | undefined>([
        ["libMale", "male"],
        ["libFemale", "female"],
        ["libUnknown", undefined],
      ])
      expect(judgeResolvedVoices(["libMale", "Adam"], resolved)).toEqual({ allowed: true })
      expect(judgeResolvedVoices(["libMale", "libFemale"], resolved)).toEqual({ allowed: false, reason: "gender_not_allowed" })
      expect(judgeResolvedVoices(["libUnknown"], resolved)).toEqual({ allowed: false, reason: "gender_unknown" })
    })
  })

  it("has nothing to judge for an empty voice list (the dispatch default is the policy's own)", () => {
    withProfile({ voice: { allowedGenders: ["male"] } }, () => {
      expect(judgeResolvedVoices([], undefined)).toEqual({ allowed: true })
    })
  })
})
