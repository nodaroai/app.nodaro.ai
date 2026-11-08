/**
 * The voice lock for a lane with no reply to send (`lib/voice-lock.ts`): a
 * speech worker's backstop and a film-studio pipeline step. Each refuses by
 * throwing `VoiceNotAvailableError`, which the video worker treats as final (a
 * refusal fails the same way on every attempt, so the job is failed and
 * refunded now instead of being retried).
 *
 * With no lock, the resolver (`lib/voice-gender.ts`, which reaches Redis and
 * the database) is never even loaded: these lanes are imported by processes
 * and tests that never touch the lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const resolver = vi.hoisted(() => ({
  judgeVoices: vi.fn(async (_voices: readonly string[], _lookup: { userId?: string | null }) => ({ allowed: true }) as const),
}))
vi.mock("@/lib/voice-gender.js", () => ({ judgeVoices: resolver.judgeVoices }))

import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"
import { VoiceNotAvailableError } from "../voice-policy.js"
import { assertUnnamedVoicesAllowed, assertVoicesAllowed, judgeVoicesUnderLock } from "../voice-lock.js"

const prevEdition = config.EDITION

function maleOnly(): void {
  config.EDITION = "business" // surfaceGateOpen() → true (read live)
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  resolver.judgeVoices.mockClear()
  __resetSurfaceProfileCacheForTests()
})
afterEach(() => {
  config.EDITION = prevEdition
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("assertVoicesAllowed", () => {
  it("with no lock, resolves without asking the resolver anything", async () => {
    await expect(assertVoicesAllowed(["Rachel", "W3C2vBPukr5b5jvoXhPK"], { userId: "u-1" })).resolves.toBeUndefined()
    expect(resolver.judgeVoices).not.toHaveBeenCalled()
  })

  it("under a lock, asks the resolver about the voices that are there, as the caller", async () => {
    maleOnly()

    await assertVoicesAllowed(["Adam", undefined, "", null, 7, "LibVoice000000000001"], { userId: "u-1" })

    expect(resolver.judgeVoices).toHaveBeenCalledWith(["Adam", "LibVoice000000000001"], { userId: "u-1" })
  })

  it("under a lock, has nothing to ask when no voice is named (the default voice is the policy's own)", async () => {
    maleOnly()

    await expect(assertVoicesAllowed([undefined, ""], { userId: "u-1" })).resolves.toBeUndefined()

    expect(resolver.judgeVoices).not.toHaveBeenCalled()
  })

  it("under a lock, a refused voice throws the lock's coded refusal, final for the worker", async () => {
    maleOnly()
    resolver.judgeVoices.mockResolvedValueOnce({ allowed: false, reason: "gender_unknown" } as never)

    const err = await assertVoicesAllowed(["W3C2vBPukr5b5jvoXhPK"], { userId: "u-1" }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(VoiceNotAvailableError)
    expect(err).toMatchObject({ code: "voice_not_available", reason: "gender_unknown", message: "The selected voice is not available on this deployment." })
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("a lookup that fails is the lookup's error, never a refusal and never final", async () => {
    maleOnly()
    resolver.judgeVoices.mockRejectedValueOnce(new Error("voice_clones lookup failed: db down"))

    const err = await assertVoicesAllowed(["W3C2vBPukr5b5jvoXhPK"], { userId: "u-1" }).catch((e: unknown) => e)

    expect(err).not.toBeInstanceOf(VoiceNotAvailableError)
    expect(isDeterministicJobError(err)).toBe(false)
  })
})

describe("judgeVoicesUnderLock — the verdict, for a route that answers it itself", () => {
  it("with no lock, allows without asking the resolver", async () => {
    await expect(judgeVoicesUnderLock(["Rachel"], { userId: "u-1" })).resolves.toEqual({ allowed: true })
    expect(resolver.judgeVoices).not.toHaveBeenCalled()
  })

  it("under a lock, hands back the resolver's verdict for the named voices", async () => {
    maleOnly()
    resolver.judgeVoices.mockResolvedValueOnce({ allowed: false, reason: "gender_not_allowed" } as never)

    await expect(judgeVoicesUnderLock(["Rachel", ""], { userId: "u-1" })).resolves.toEqual({ allowed: false, reason: "gender_not_allowed" })
    expect(resolver.judgeVoices).toHaveBeenCalledWith(["Rachel"], { userId: "u-1" })
  })
})

describe("assertUnnamedVoicesAllowed — speech whose voices nobody names (a dub)", () => {
  it("with no lock, passes", () => {
    expect(() => assertUnnamedVoicesAllowed("Dubbing is not available on this deployment.")).not.toThrow()
  })

  it("under a lock, refuses with the lane's own sentence and the lock's code", () => {
    maleOnly()

    let err: unknown
    try {
      assertUnnamedVoicesAllowed("Dubbing is not available on this deployment.")
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(VoiceNotAvailableError)
    expect(err).toMatchObject({ code: "voice_not_available", reason: "gender_unknown", message: "Dubbing is not available on this deployment." })
    expect(isDeterministicJobError(err)).toBe(true)
  })
})
