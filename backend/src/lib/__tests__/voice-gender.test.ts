/**
 * The voice lock's resolver (`lib/voice-gender.ts`): what the platform can
 * VOUCH for about a voice's gender, from the voice's id alone. A caller's
 * `voiceType` is never consulted: a library id sent as "premade" used to slip
 * past the premade-only check.
 *
 * Sources, all server-side: the premade catalog (by name or by id), the
 * caller's own legacy clone, the gender the Voice Library stated when this
 * deployment's library listing served the voice, and the live premade
 * catalog. Under a lock a voice none of them knows is refused; with no lock
 * nothing is looked up at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueryResult, RecordedQuery } from "./fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000b2"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  clones: [] as Array<{ user_id: string; elevenlabs_voice_id: string; gender: string | null }>,
  fail: false,
}))
const library = vi.hoisted(() => ({ recorded: new Map<string, string>(), reads: 0 }))
const live = vi.hoisted(() => ({ voices: [] as Array<{ voice_id: string; name: string; gender: string }>, reads: 0 }))

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom, has } = await import("./fake-supabase-query.js")
  return {
    supabase: {
      from: makeFakeFrom(db.log, (q): QueryResult => {
        if (db.fail) return { data: null, error: { message: "db down" } }
        if (q.table !== "voice_clones") return { data: null, error: null }
        const rows = db.clones.filter((c) =>
          has(q, "eq", "elevenlabs_voice_id", c.elevenlabs_voice_id) && has(q, "eq", "user_id", c.user_id))
        return { data: rows.map((r) => ({ gender: r.gender })), error: null }
      }),
    },
  }
})
vi.mock("@/lib/library-voice-genders.js", () => ({
  recordedLibraryVoiceGender: vi.fn(async (voiceId: string) => {
    library.reads++
    return library.recorded.get(voiceId)
  }),
}))
vi.mock("@/lib/premade-voice-catalog.js", () => ({
  getPremadeVoices: vi.fn(async () => {
    live.reads++
    return live.voices
  }),
}))

import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { judgeVoice, judgeVoices, resolveVoiceGender, resolveVoiceGenders } from "../voice-gender.js"

const prevEdition = config.EDITION

function lock(allowedGenders: string[]): void {
  config.EDITION = "business" // surfaceGateOpen() → true (read live)
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders } })
  __resetSurfaceProfileCacheForTests()
}

function lookups(): number {
  return db.log.length + library.reads + live.reads
}

beforeEach(() => {
  db.log.length = 0
  db.clones.length = 0
  db.fail = false
  library.recorded.clear()
  library.reads = 0
  live.voices = []
  live.reads = 0
  __resetSurfaceProfileCacheForTests()
})
afterEach(() => {
  config.EDITION = prevEdition
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("with no lock, nothing is looked up", () => {
  it("allows any voice and reads no source", async () => {
    expect(await judgeVoice("Rachel", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("W3C2vBPukr5b5jvoXhPK", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoices(["W3C2vBPukr5b5jvoXhPK", "Rachel"], { userId: OWNER })).toEqual({ allowed: true })
    expect(await resolveVoiceGenders(["W3C2vBPukr5b5jvoXhPK"], { userId: OWNER })).toBeUndefined()

    expect(lookups()).toBe(0)
  })
})

describe("a male-only lock", () => {
  beforeEach(() => lock(["male"]))

  it("judges a premade voice by its name or its id, with no lookup", async () => {
    expect(await judgeVoice("Brian", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("nPczCjzI2devNBz1zQrb", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("Rachel", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_not_allowed" })
    // Rachel by her voice id: the catalog stores her by name, so the old
    // premade-only check knew nothing about this id and let it through.
    expect(await judgeVoice("21m00Tcm4TlvDq8ikWAM", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_not_allowed" })

    expect(lookups()).toBe(0)
  })

  it("takes a library voice's gender from what the library listing recorded", async () => {
    library.recorded.set("LibMale00000000000001", "male")
    library.recorded.set("LibFemale000000000001", "female")

    expect(await judgeVoice("LibMale00000000000001", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("LibFemale000000000001", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_not_allowed" })
  })

  it("takes a clone's gender from the caller's own clone row only", async () => {
    db.clones.push(
      { user_id: OWNER, elevenlabs_voice_id: "CloneMale000000000001", gender: "male" },
      { user_id: OWNER, elevenlabs_voice_id: "CloneFemale0000000001", gender: "female" },
      { user_id: OWNER, elevenlabs_voice_id: "CloneNoGender00000001", gender: null },
      { user_id: OTHER, elevenlabs_voice_id: "CloneOfOther000000001", gender: "male" },
    )

    expect(await judgeVoice("CloneMale000000000001", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("CloneFemale0000000001", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_not_allowed" })
    expect(await judgeVoice("CloneNoGender00000001", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_unknown" })
    expect(await judgeVoice("CloneOfOther000000001", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_unknown" })
  })

  it("asks no clone row when it does not know who is asking", async () => {
    db.clones.push({ user_id: OWNER, elevenlabs_voice_id: "CloneMale000000000001", gender: "male" })

    expect(await judgeVoice("CloneMale000000000001", {})).toEqual({ allowed: false, reason: "gender_unknown" })
    expect(db.log.filter((q) => q.table === "voice_clones")).toHaveLength(0)
  })

  it("knows a premade voice the static catalog lacks from the live premade catalog", async () => {
    live.voices = [{ voice_id: "NewPremade00000000001", name: "Newcomer", gender: "male" }]

    expect(await judgeVoice("NewPremade00000000001", { userId: OWNER })).toEqual({ allowed: true })
    expect(await resolveVoiceGender("Newcomer", { userId: OWNER })).toBe("male")
  })

  it("refuses a voice it cannot vouch for", async () => {
    expect(await judgeVoice("W3C2vBPukr5b5jvoXhPK", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_unknown" })
  })

  it("has nothing to judge for an empty voice (the dispatch default is the policy's own)", async () => {
    expect(await judgeVoice(undefined, { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("", { userId: OWNER })).toEqual({ allowed: true })
    expect(lookups()).toBe(0)
  })

  it("judges several voices and refuses when any one fails", async () => {
    library.recorded.set("LibMale00000000000001", "male")

    expect(await judgeVoices(["Brian", "LibMale00000000000001"], { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoices(["Brian", "W3C2vBPukr5b5jvoXhPK"], { userId: OWNER })).toEqual({ allowed: false, reason: "gender_unknown" })
    expect(await judgeVoices(["Rachel", "Brian"], { userId: OWNER })).toEqual({ allowed: false, reason: "gender_not_allowed" })
  })

  it("resolves the voices a builder will dispatch, unknown ones included, once each", async () => {
    library.recorded.set("LibMale00000000000001", "male")

    const resolved = await resolveVoiceGenders(["LibMale00000000000001", "Rachel", "W3C2vBPukr5b5jvoXhPK", "Rachel"], { userId: OWNER })

    expect(resolved).toEqual(new Map([
      ["LibMale00000000000001", "male"],
      ["Rachel", "female"],
      ["W3C2vBPukr5b5jvoXhPK", undefined],
    ]))
  })

  it("throws when a lookup fails — a server error, never a silent allow or a refusal of the voice", async () => {
    db.fail = true

    await expect(judgeVoice("CloneMale000000000001", { userId: OWNER })).rejects.toThrow(/voice_clones/)
  })
})

describe("a lock that allows neutral", () => {
  beforeEach(() => lock(["male", "neutral"]))

  it("still refuses a voice whose gender nobody knows", async () => {
    db.clones.push({ user_id: OWNER, elevenlabs_voice_id: "CloneNoGender00000001", gender: "" })

    expect(await judgeVoice("River", { userId: OWNER })).toEqual({ allowed: true })
    expect(await judgeVoice("CloneNoGender00000001", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_unknown" })
    expect(await judgeVoice("W3C2vBPukr5b5jvoXhPK", { userId: OWNER })).toEqual({ allowed: false, reason: "gender_unknown" })
  })
})
