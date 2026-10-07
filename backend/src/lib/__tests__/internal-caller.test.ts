import { describe, it, expect } from "vitest"
import { config } from "../config.js"
import { internalRequestUser, internalSecretMatches } from "../internal-caller.js"

// test/setup.ts sets the secret ("0" × 64) before config loads.
const SECRET = config.INTERNAL_ORCHESTRATOR_SECRET
const USER = "00000000-0000-4000-8000-0000000000aa"

describe("internalSecretMatches — the one check behind the auth hook and the rate limiter", () => {
  it("matches the configured secret only", () => {
    expect(internalSecretMatches(SECRET)).toBe(true)
    expect(internalSecretMatches(`${SECRET}0`)).toBe(false)
    expect(internalSecretMatches("f".repeat(SECRET.length))).toBe(false)
    expect(internalSecretMatches("")).toBe(false)
  })

  it("never matches a value that is not a string", () => {
    expect(internalSecretMatches(undefined)).toBe(false)
    expect(internalSecretMatches(null)).toBe(false)
    expect(internalSecretMatches([SECRET])).toBe(false)
    expect(internalSecretMatches(42)).toBe(false)
  })

  it("matches nothing, and never throws, when no secret is configured", () => {
    // A route test's config mock can leave the secret out; Buffer.from(undefined)
    // would throw inside the comparison and turn a refusal into a 500.
    const writable = config as { INTERNAL_ORCHESTRATOR_SECRET: string | undefined }
    const saved = writable.INTERNAL_ORCHESTRATOR_SECRET
    try {
      for (const unset of [undefined, ""]) {
        writable.INTERNAL_ORCHESTRATOR_SECRET = unset
        expect(() => internalSecretMatches("anything")).not.toThrow()
        expect(internalSecretMatches("anything")).toBe(false)
        expect(internalSecretMatches("")).toBe(false)
      }
    } finally {
      writable.INTERNAL_ORCHESTRATOR_SECRET = saved
    }
  })
})

describe("internalRequestUser — who an internal request acts for, as the limiter keys it", () => {
  it("names the user of a request whose secret matches", () => {
    expect(internalRequestUser({ "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": USER })).toBe(USER)
  })

  it("lower-cases the id so one user is one bucket", () => {
    expect(internalRequestUser({ "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": USER.toUpperCase() })).toBe(USER)
  })

  it("reads the first value of a repeated header, as the auth hook does", () => {
    expect(internalRequestUser({ "x-internal-orchestrator-secret": [SECRET, "x"], "x-internal-user-id": [USER, "y"] })).toBe(USER)
  })

  it("is null for a forged secret, a missing secret, a missing user and a malformed user", () => {
    expect(internalRequestUser({ "x-internal-orchestrator-secret": "forged", "x-internal-user-id": USER })).toBeNull()
    expect(internalRequestUser({ "x-internal-user-id": USER })).toBeNull()
    expect(internalRequestUser({ "x-internal-orchestrator-secret": SECRET })).toBeNull()
    expect(internalRequestUser({ "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": "user-1" })).toBeNull()
    expect(internalRequestUser({ "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": `${USER} ` })).toBeNull()
  })
})
