import { describe, it, expect } from "vitest"
import { parseSsoProviders, ssoPublicInfo } from "../sso-providers.js"

describe("parseSsoProviders", () => {
  it("returns [] for unset config", () => {
    expect(parseSsoProviders("")).toEqual([])
    expect(parseSsoProviders(undefined)).toEqual([])
  })

  it("parses an assertion provider and defaults the claim map + lifetime", () => {
    const raw = JSON.stringify([
      { id: "librechat", label: "LibreChat", kind: "assertion", secret: "s".repeat(32), audience: "nodaro" },
    ])
    const [p] = parseSsoProviders(raw)
    expect(p.id).toBe("librechat")
    expect(p.claimMap).toEqual({ email: "email", emailVerified: "email_verified", subject: "sub" })
    expect(p.maxLifetimeSeconds).toBe(300)
  })

  it("THROWS when an assertion provider omits its secret (fail loud, never drop)", () => {
    const raw = JSON.stringify([{ id: "x", label: "X", kind: "assertion", audience: "nodaro" }])
    expect(() => parseSsoProviders(raw)).toThrow(/secret/i)
  })

  it("THROWS when an assertion provider omits its audience", () => {
    const raw = JSON.stringify([{ id: "x", label: "X", kind: "assertion", secret: "s".repeat(32) }])
    expect(() => parseSsoProviders(raw)).toThrow(/audience/i)
  })

  it("THROWS on a duplicate provider id", () => {
    const one = { id: "dup", label: "A", kind: "oidc", domain: "a.com" }
    const two = { id: "dup", label: "B", kind: "oidc", domain: "b.com" }
    expect(() => parseSsoProviders(JSON.stringify([one, two]))).toThrow(/duplicate/i)
  })

  it("THROWS on a non-url-safe id", () => {
    const raw = JSON.stringify([{ id: "has space", label: "X", kind: "oidc", domain: "a.com" }])
    expect(() => parseSsoProviders(raw)).toThrow(/id/i)
  })

  it("ssoPublicInfo strips the secret and every non-public field", () => {
    const [p] = parseSsoProviders(
      JSON.stringify([{ id: "lc", label: "LibreChat", kind: "assertion", secret: "s".repeat(32), audience: "nodaro" }]),
    )
    expect(ssoPublicInfo(p)).toEqual({ id: "lc", label: "LibreChat", kind: "assertion" })
    expect(JSON.stringify(ssoPublicInfo(p))).not.toContain("s".repeat(32))
  })
})
