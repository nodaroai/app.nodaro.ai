import { describe, it, expect } from "vitest"
import type { AdminUserAccess } from "@/ee/hooks/queries/use-admin-access"
import { signInLag } from "../sign-in-lag"

/**
 * Where an account's sign-in disagrees with its block and its suspension, as
 * the server judged it: "allow" when sign-in is wanted and our ban refuses it,
 * "refuse" when it should be refused and is not, "correct" when it is refused
 * until another end; a blocked account whose sign-in is not refused has its
 * own retry; agreement, a ban that could not be read, and a server that does
 * not say offer nothing.
 */

const access = (over: Partial<AdminUserAccess>): AdminUserAccess => ({
  ready: true,
  blocked: false,
  reason: null,
  blockedAt: null,
  signInBlocked: false,
  signInBanIsOurs: null,
  network: null,
  ...over,
})

describe("signInLag", () => {
  it("sign-in wanted, refused by our ban: allow", () => {
    expect(signInLag(access({ signInBlocked: true, signInBanIsOurs: true, signInWanted: "allowed", signInInLine: false }))).toBe("allow")
  })

  it("sign-in to be refused, and not refused: refuse", () => {
    expect(signInLag(access({ suspendedUntil: "2026-11-17T12:00:00.000Z", signInBlocked: false, signInWanted: "refused", signInInLine: false }))).toBe("refuse")
  })

  it("refused until another end (an unblock of a suspended account that failed): correct", () => {
    expect(signInLag(access({ suspendedUntil: "2026-11-17T12:00:00.000Z", signInBlocked: true, signInBanIsOurs: true, signInWanted: "refused", signInInLine: false }))).toBe("correct")
    expect(signInLag(access({ blocked: true, signInBlocked: true, signInBanIsOurs: true, signInWanted: "refused", signInInLine: false }))).toBe("correct")
  })

  it("agreement, a blocked account not refused yet (Block again), a ban that could not be read, and a server that does not say: nothing", () => {
    expect(signInLag(access({ signInWanted: "allowed", signInInLine: true }))).toBeNull()
    expect(signInLag(access({ blocked: true, signInBlocked: false, signInWanted: "refused", signInInLine: false }))).toBeNull()
    expect(signInLag(access({ signInBlocked: null, signInInLine: null }))).toBeNull()
    expect(signInLag(access({ signInBlocked: true, signInBanIsOurs: true }))).toBeNull()
  })
})
