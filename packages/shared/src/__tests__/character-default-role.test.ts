// packages/shared/src/__tests__/character-default-role.test.ts
import { describe, it, expect } from "vitest"
import { resolveDefaultRole, sanitizeRole } from "../reference-roles.js"
import { characterLockToRefLock, getIdentityLockClause } from "../identity-lock.js"

describe("resolveDefaultRole", () => {
  it("prefers an explicit defaultRole verbatim (Custom survives)", () => {
    expect(resolveDefaultRole("clothes", undefined, "wired-character")).toBe("clothes")
    // A Custom role wins over a defaultUsageMode-derived role.
    expect(resolveDefaultRole("earrings", "face", "wired-character")).toBe("earrings")
  })

  it("falls back to the defaultUsageMode-derived role when no defaultRole", () => {
    expect(resolveDefaultRole(undefined, "face", "wired-character")).toBe("face")
    expect(resolveDefaultRole(undefined, "pose", "wired-character")).toBe("pose")
    expect(resolveDefaultRole(undefined, "style", "wired-character")).toBe("style")
  })

  it("collapses non-preset usage modes to the source default", () => {
    expect(resolveDefaultRole(undefined, "identical", "wired-character")).toBe("person")
    expect(resolveDefaultRole(undefined, "face-pose", "wired-character")).toBe("person")
    expect(resolveDefaultRole(undefined, "emotion", "wired-character")).toBe("person")
    expect(resolveDefaultRole(undefined, undefined, "wired-character")).toBe("person")
  })

  it("ignores a blank/whitespace defaultRole", () => {
    expect(resolveDefaultRole("   ", "style", "wired-character")).toBe("style")
    expect(resolveDefaultRole("", undefined, "wired-character")).toBe("person")
  })
})

describe("characterLockToRefLock", () => {
  it("maps off -> disabled (no line)", () => {
    expect(characterLockToRefLock("off")).toEqual({ enabled: false })
  })

  it("maps soft -> enabled with a {ref}-BOUND mild clause (per-reference attribution)", () => {
    const lock = characterLockToRefLock("soft")
    expect(lock.enabled).toBe(true)
    expect(lock.text).toContain("{ref}")
    expect(lock.text).toContain("overall facial likeness")
  })

  it("maps strict -> enabled with a {ref}-BOUND strong clause", () => {
    const lock = characterLockToRefLock("strict")
    expect(lock.enabled).toBe(true)
    expect(lock.text).toContain("{ref}")
    expect(lock.text).toContain("must match exactly")
  })

  it("coerces undefined -> soft (DEFAULT_IDENTITY_LOCK, the accepted back-compat behavior)", () => {
    expect(characterLockToRefLock(undefined)).toEqual(characterLockToRefLock("soft"))
  })

  it("soft and strict escalate like getIdentityLockClause but stay reference-bound", () => {
    // The node ladder mirrors the config panel's semantics; the emitted text is
    // the {ref}-bound variant so multi-character lock blocks stay attributable.
    expect(getIdentityLockClause("soft")).toBeTruthy()
    expect(getIdentityLockClause("strict")).toBeTruthy()
    expect(characterLockToRefLock("soft").text).not.toBe(getIdentityLockClause("soft"))
    expect(characterLockToRefLock("strict").text).not.toBe(getIdentityLockClause("strict"))
  })
})

describe("sanitizeRole (hoisted to shared)", () => {
  it("slugifies a Custom role", () => {
    expect(sanitizeRole("Gold Ring")).toBe("gold-ring")
    expect(sanitizeRole("  freckles  ")).toBe("freckles")
  })
})
