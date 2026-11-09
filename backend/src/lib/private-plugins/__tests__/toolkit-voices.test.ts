/**
 * `tk.voices` — the deployment's voice lock for the voices a plugin route
 * sends (a conversion's target voices, a dub's voices): the same verdict the
 * platform's own speech routes give (lib/voice-gender.ts), read at call time.
 *
 * A refusal is a `PluginHttpError` the route sends verbatim (400
 * voice_not_available); a failed lookup is the lookup's own error, never a
 * refusal; with no lock nothing is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueryResult, RecordedQuery } from "../../__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  clones: [] as Array<{ user_id: string; elevenlabs_voice_id: string; gender: string | null }>,
  fail: false,
}))
const libraryGenders = vi.hoisted(() => new Map<string, string>())

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom, has } = await import("../../__tests__/fake-supabase-query.js")
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
  recordedLibraryVoiceGender: vi.fn(async (voiceId: string) => libraryGenders.get(voiceId)),
  recordLibraryVoiceGenders: vi.fn(async () => {}),
}))
vi.mock("@/lib/premade-voice-catalog.js", () => ({ getPremadeVoices: vi.fn(async () => []) }))

import { buildToolkit } from "../toolkit.js"
import { config } from "../../config.js"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import { VoiceNotAvailableError } from "../../voice-gender.js"
import { recordedLibraryVoiceGender } from "../../library-voice-genders.js"

const prevEdition = config.EDITION

function maleOnly(): void {
  config.EDITION = "business" // surfaceGateOpen() → true (read live)
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

function voices() {
  const member = buildToolkit().voices
  expect(member).toBeDefined()
  return member!
}

async function refusalOf(call: Promise<unknown>) {
  const err = await call.catch((e: unknown) => e)
  expect(err).toMatchObject({
    name: "PluginHttpError",
    statusCode: 400,
    body: { error: { code: "voice_not_available", message: "The selected voice is not available on this deployment." } },
  })
  expect((err as Error).cause).toBeInstanceOf(VoiceNotAvailableError)
  return (err as Error).cause as VoiceNotAvailableError
}

beforeEach(() => {
  db.log.length = 0
  db.clones.length = 0
  db.fail = false
  libraryGenders.clear()
  vi.clearAllMocks()
  __resetSurfaceProfileCacheForTests()
})
afterEach(() => {
  config.EDITION = prevEdition
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("tk.voices.isLocked", () => {
  it("follows the deployment's profile, read at call time", () => {
    const tk = voices()
    expect(tk.isLocked()).toBe(false)

    maleOnly()

    expect(tk.isLocked()).toBe(true)
  })
})

describe("tk.voices.assertAllowed", () => {
  it("with no lock, allows any voice and reads nothing", async () => {
    await expect(voices().assertAllowed("W3C2vBPukr5b5jvoXhPK", { userId: OWNER })).resolves.toBeUndefined()
    await expect(voices().assertAllowed("Rachel", { userId: OWNER })).resolves.toBeUndefined()

    expect(db.log).toHaveLength(0)
    expect(recordedLibraryVoiceGender).not.toHaveBeenCalled()
  })

  it("under a lock, allows a voice of an allowed gender: premade, the caller's own clone, a listed library voice", async () => {
    maleOnly()
    db.clones.push({ user_id: OWNER, elevenlabs_voice_id: "CloneMale000000000001", gender: "male" })
    libraryGenders.set("LibMale00000000000001", "male")

    for (const voiceId of ["Adam", "nPczCjzI2devNBz1zQrb", "CloneMale000000000001", "LibMale00000000000001"]) {
      await expect(voices().assertAllowed(voiceId, { userId: OWNER })).resolves.toBeUndefined()
    }
  })

  it("refuses a voice of a disallowed gender, by name or by id", async () => {
    maleOnly()

    expect((await refusalOf(voices().assertAllowed("Rachel", { userId: OWNER }))).reason).toBe("gender_not_allowed")
    expect((await refusalOf(voices().assertAllowed("21m00Tcm4TlvDq8ikWAM", { userId: OWNER }))).reason).toBe("gender_not_allowed")
  })

  it("refuses a voice whose gender nothing can vouch for", async () => {
    maleOnly()

    expect((await refusalOf(voices().assertAllowed("W3C2vBPukr5b5jvoXhPK", { userId: OWNER }))).reason).toBe("gender_unknown")
  })

  it("rejects with the lookup's own error when a lookup fails — never a refusal of the voice", async () => {
    maleOnly()
    db.fail = true

    const err = await voices().assertAllowed("CloneMale000000000001", { userId: OWNER }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).not.toBe("PluginHttpError")
  })
})
