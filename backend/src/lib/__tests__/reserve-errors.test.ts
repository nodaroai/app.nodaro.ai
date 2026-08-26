/**
 * E2/P14 W3 — the refusal vocabulary. What these pin: every 351 reserve
 * prefix maps to its stable status+code with a FIXED message that never
 * echoes the raw text; matching is ANCHORED (content merely containing a
 * prefix cannot spoof a refusal out of a real fault); and ReserveRpcError
 * carries the identity through wrapper layers where string-matching died.
 */
import { describe, expect, it } from "vitest"
import { ReserveRpcError, mapReserveError, reservePrefixOf } from "../reserve-errors.js"

const TABLE = [
  ["BUDGET_EXCEEDED", 402, "budget_exceeded"],
  ["MEMBER_CAP_EXCEEDED", 402, "member_cap_exceeded"],
  // 409/not_a_member: aligned to the platform's ONE vocabulary — the
  // frontend's stale-workspace self-heal keys on not_a_member, and
  // workspace_archived is publicly documented as 409 (P14.3 review).
  ["WORKSPACE_ARCHIVED", 409, "workspace_archived"],
  ["MEMBER_SUSPENDED", 403, "member_suspended"],
  ["MEMBER_NOT_FOUND", 403, "not_a_member"],
  ["WORKSPACE_NOT_FOUND", 404, "workspace_not_found"],
] as const

describe("the prefix table", () => {
  it.each(TABLE)("%s → %i %s, raw text never echoed", (prefix, status, code) => {
    const raw = `${prefix}: allocated 5000, need 40, user 123e4567-e89b-42d3-a456-426614174000`
    const mapped = mapReserveError(new Error(raw))
    expect(mapped).toMatchObject({ status, code })
    expect(mapped!.message).not.toContain("5000")
    expect(mapped!.message).not.toContain("123e4567")
  })

  it("matching is ANCHORED — a prefix inside the message is a real fault, not a refusal", () => {
    expect(mapReserveError(new Error(`Credit reservation failed: BUDGET_EXCEEDED: allocated 5`))).toBeNull()
    expect(reservePrefixOf("deadlock detected near BUDGET_EXCEEDED:")).toBeNull()
  })

  it("unknown prefixes and non-errors are null — they must surface as 500s", () => {
    expect(mapReserveError(new Error("SUBSCRIPTION_REQUIRED: pool empty"))).toBeNull()
    expect(mapReserveError(new Error("deadlock detected"))).toBeNull()
    expect(mapReserveError("BUDGET_EXCEEDED: string, not Error")).toBeNull()
    expect(mapReserveError(null)).toBeNull()
  })
})

describe("ReserveRpcError — identity through the wrappers", () => {
  it("carries the prefix even when its message no longer starts with it", () => {
    const err = new ReserveRpcError("BUDGET_EXCEEDED", "BUDGET_EXCEEDED: allocated 5000, need 40")
    expect(err.message).toBe("The workspace budget cannot cover this run")
    expect(mapReserveError(err)).toMatchObject({ status: 402, code: "budget_exceeded" })
    // The raw text survives for logs only.
    expect(err.raw).toContain("5000")
  })

  it("reservePrefixOf recognizes exactly the reserve vocabulary", () => {
    expect(reservePrefixOf("MEMBER_NOT_FOUND: user x")).toBe("MEMBER_NOT_FOUND")
    expect(reservePrefixOf("RECLAIM_EXCEEDS_AVAILABLE: y")).toBeNull() // allocate-side, not reserve
    expect(reservePrefixOf(null)).toBeNull()
  })
})
