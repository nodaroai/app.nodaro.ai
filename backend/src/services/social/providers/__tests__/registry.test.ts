import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { z } from "zod"

import { PROVIDERS, providerIds, getProvider, isConfigured, missingEnv, providerPublicInfo } from "../registry.js"

/**
 * Registry totality guard — the spec's Phase 0.9 test. Every rule here exists
 * so a new network CANNOT be half-registered: miss a required member for your
 * connectKind and this suite fails, before any route runs.
 */

const ALL = Object.values(PROVIDERS)

describe("provider registry totality", () => {
  it("map keys match descriptor ids", () => {
    for (const [key, p] of Object.entries(PROVIDERS)) {
      expect(p.id).toBe(key)
    }
  })

  it("every provider has a publisher, a label, and non-empty media capabilities", () => {
    for (const p of ALL) {
      expect(p.publisher, p.id).toBeDefined()
      expect(typeof p.publisher.publish, p.id).toBe("function")
      expect(p.label.length, p.id).toBeGreaterThan(0)
      expect(p.capabilities.media.length, p.id).toBeGreaterThan(0)
    }
  })

  it("oauth2 kinds declare oauth config AND non-empty requiredEnv (§2.5 rule)", () => {
    for (const p of ALL) {
      if (p.connectKind === "oauth2" || p.connectKind === "oauth2_between_steps") {
        expect(p.oauth, `${p.id} missing oauth config`).toBeDefined()
        expect(p.requiredEnv.length, `${p.id} must declare requiredEnv`).toBeGreaterThan(0)
      }
    }
  })

  it("custom_fields/bot_token kinds declare EMPTY requiredEnv (work out of the box)", () => {
    for (const p of ALL) {
      if (p.connectKind === "custom_fields" || p.connectKind === "bot_token") {
        expect(p.requiredEnv.length, `${p.id} must not require env`).toBe(0)
      }
      if (p.connectKind === "custom_fields") {
        expect(p.customFields, `${p.id} missing customFields()`).toBeDefined()
        expect(typeof p.connectWithFields, `${p.id} missing connectWithFields()`).toBe("function")
        // Every declared field must be renderable: key+label+type present.
        for (const f of p.customFields!()) {
          expect(f.key.length, `${p.id} field key`).toBeGreaterThan(0)
          expect(f.label.length, `${p.id} field label`).toBeGreaterThan(0)
          expect(["text", "password"]).toContain(f.type)
        }
        // At least one secret field — it becomes access_token_encrypted.
        expect(
          p.customFields!().some((f) => f.type === "password"),
          `${p.id} needs a password-type field`,
        ).toBe(true)
      }
    }
  })

  it("plain oauth2 providers resolve a single account via fetchUserInfo", () => {
    for (const p of ALL) {
      if (p.connectKind === "oauth2") {
        expect(typeof p.fetchUserInfo, p.id).toBe("function")
      }
    }
  })

  it("between-steps providers implement the full picker contract", () => {
    for (const p of ALL) {
      if (p.connectKind === "oauth2_between_steps") {
        expect(typeof p.listAccounts, p.id).toBe("function")
        expect(typeof p.finalizeAccount, p.id).toBe("function")
        expect(p.noAccountsMessage, p.id).toBeTruthy()
      }
    }
  })

  it("refresh: 'real' requires an oauth token endpoint to refresh against", () => {
    for (const p of ALL) {
      if (p.capabilities.refresh === "real") {
        expect(p.oauth, `${p.id} claims real refresh but has no oauth config`).toBeDefined()
      }
    }
  })

  it("the 7 launch platforms are registered", () => {
    for (const id of ["instagram", "facebook", "tiktok", "youtube", "linkedin", "x", "telegram"]) {
      expect(getProvider(id), id).not.toBeNull()
    }
    expect(getProvider("not-a-network")).toBeNull()
  })

  it("providerIds() derives a working Zod enum", () => {
    const schema = z.enum(providerIds())
    expect(schema.safeParse("instagram").success).toBe(true)
    expect(schema.safeParse("postiz").success).toBe(false)
  })
})

describe("per-deployment availability (§2.5)", () => {
  const saved: Record<string, string | undefined> = {}
  const VARS = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]

  beforeEach(() => {
    for (const v of VARS) saved[v] = process.env[v]
  })
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
  })

  it("isConfigured reflects env presence", () => {
    const tiktok = getProvider("tiktok")!
    process.env.TIKTOK_CLIENT_KEY = "k"
    process.env.TIKTOK_CLIENT_SECRET = "s"
    expect(isConfigured(tiktok)).toBe(true)
    expect(missingEnv(tiktok)).toEqual([])

    delete process.env.TIKTOK_CLIENT_SECRET
    expect(isConfigured(tiktok)).toBe(false)
    expect(missingEnv(tiktok)).toEqual(["TIKTOK_CLIENT_SECRET"])
  })

  it("bot_token providers are always available", () => {
    expect(isConfigured(getProvider("telegram")!)).toBe(true)
  })

  it("providerPublicInfo exposes availability + var NAMES only, never values", () => {
    process.env.TIKTOK_CLIENT_KEY = "super-secret-key-value"
    delete process.env.TIKTOK_CLIENT_SECRET

    const info = providerPublicInfo(getProvider("tiktok")!)
    expect(info.available).toBe(false)
    expect(info.missingEnv).toEqual(["TIKTOK_CLIENT_SECRET"])
    expect(JSON.stringify(info)).not.toContain("super-secret-key-value")

    process.env.TIKTOK_CLIENT_SECRET = "s"
    const ok = providerPublicInfo(getProvider("tiktok")!)
    expect(ok.available).toBe(true)
    expect(ok.missingEnv).toBeUndefined()
  })
})
