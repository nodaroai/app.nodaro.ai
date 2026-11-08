/**
 * The record of library voices' genders (`lib/library-voice-genders.ts`).
 *
 * The Voice Library has no lookup by voice id, so a voice lock cannot ask it
 * what a given id is. The platform therefore remembers the gender the library
 * stated for each voice its own listing (`GET /v1/voices/library`) served:
 * written only while a lock is set, kept in Redis so every process (the API
 * and the orchestrator) reads the same record, and read by the lock's
 * resolver. A voice never served while locked is simply unknown, and refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const store = vi.hoisted(() => ({
  map: new Map<string, { value: string; ttl: number }>(),
  reads: 0,
  writes: 0,
}))

vi.mock("@/lib/queue-connection.js", () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      store.reads++
      return store.map.get(key)?.value ?? null
    }),
    pipeline: vi.fn(() => {
      const ops: Array<[string, string, number]> = []
      const p = {
        set(key: string, value: string, _mode: string, ttl: number) {
          ops.push([key, value, ttl])
          return p
        },
        async exec() {
          for (const [key, value, ttl] of ops) {
            store.map.set(key, { value, ttl })
            store.writes++
          }
          return []
        },
      }
      return p
    }),
  },
}))

import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { LIBRARY_VOICE_GENDER_KEY_PREFIX, recordedLibraryVoiceGender, recordLibraryVoiceGenders } from "../library-voice-genders.js"

const prevEdition = config.EDITION

function lock(allowedGenders: string[]): void {
  config.EDITION = "business"
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders } })
  __resetSurfaceProfileCacheForTests()
}

const SERVED = [
  { voice_id: "LibMale00000000000001", gender: "male" },
  { voice_id: "LibFemale000000000001", gender: "Female" },
  { voice_id: "LibNeutral00000000001", gender: "neutral" },
  { voice_id: "LibUnlabelled00000001", gender: "" },
  { voice_id: "LibOdd000000000000001", gender: "robot" },
  { voice_id: "not a voice id!", gender: "male" },
]

beforeEach(() => {
  store.map.clear()
  store.reads = 0
  store.writes = 0
  __resetSurfaceProfileCacheForTests()
})
afterEach(() => {
  config.EDITION = prevEdition
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("recordLibraryVoiceGenders", () => {
  it("writes nothing when no voice lock is set", async () => {
    await recordLibraryVoiceGenders(SERVED)

    expect(store.writes).toBe(0)
  })

  it("under a lock, records every served voice whose gender the library states, allowed or not", async () => {
    lock(["male"])

    await recordLibraryVoiceGenders(SERVED)

    expect([...store.map.entries()].map(([k, v]) => [k, v.value])).toEqual([
      [`${LIBRARY_VOICE_GENDER_KEY_PREFIX}LibMale00000000000001`, "male"],
      [`${LIBRARY_VOICE_GENDER_KEY_PREFIX}LibFemale000000000001`, "female"],
      [`${LIBRARY_VOICE_GENDER_KEY_PREFIX}LibNeutral00000000001`, "neutral"],
    ])
    // Long-lived and refreshed on every listing: a voice's gender does not change.
    for (const { ttl } of store.map.values()) expect(ttl).toBeGreaterThanOrEqual(30 * 24 * 3600)
  })

  it("writes nothing for an empty page", async () => {
    lock(["male"])

    await recordLibraryVoiceGenders([])

    expect(store.writes).toBe(0)
  })
})

describe("recordedLibraryVoiceGender", () => {
  beforeEach(() => lock(["male"]))

  it("reads back the gender the listing recorded", async () => {
    await recordLibraryVoiceGenders(SERVED)

    expect(await recordedLibraryVoiceGender("LibMale00000000000001")).toBe("male")
    expect(await recordedLibraryVoiceGender("LibFemale000000000001")).toBe("female")
  })

  it("is unknown for a voice never recorded, or a stored value that is not a gender", async () => {
    store.map.set(`${LIBRARY_VOICE_GENDER_KEY_PREFIX}LibGarbage00000000001`, { value: "robot", ttl: 1 })

    expect(await recordedLibraryVoiceGender("LibNever0000000000001")).toBeUndefined()
    expect(await recordedLibraryVoiceGender("LibGarbage00000000001")).toBeUndefined()
  })

  it("does not ask Redis about something that is not a voice id", async () => {
    expect(await recordedLibraryVoiceGender("not a voice id!")).toBeUndefined()
    expect(await recordedLibraryVoiceGender("x".repeat(65))).toBeUndefined()
    expect(store.reads).toBe(0)
  })
})
