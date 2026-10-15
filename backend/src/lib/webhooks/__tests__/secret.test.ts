/**
 * Signing secrets (lib/webhooks/secret.ts): generated as `whsec_<random>`,
 * stored only as an envelope sealed with a per-environment subkey of the
 * instance key and bound to its row, so a ciphertext copied onto another
 * endpoint, another owner or another environment does not open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODARO_ENCRYPTION_KEY: "", SOCIAL_ENCRYPTION_KEY: "" },
}))
vi.mock("../../config.js", () => ({ config: mockConfig }))

import { resetInstanceCipherForTests } from "../../instance-cipher.js"
import { generateSigningSecret, openSigningSecret, sealSigningSecret } from "../secret.js"

const BINDING = {
  endpointId: "00000000-0000-4000-8000-0000000000e1",
  userId: "00000000-0000-4000-8000-000000000001",
  runtimeEnv: "production",
}

const savedEnv = { nodaro: process.env.NODARO_ENCRYPTION_KEY, social: process.env.SOCIAL_ENCRYPTION_KEY }

beforeEach(() => {
  delete process.env.NODARO_ENCRYPTION_KEY
  delete process.env.SOCIAL_ENCRYPTION_KEY
  mockConfig.NODARO_ENCRYPTION_KEY = "a".repeat(64)
  mockConfig.SOCIAL_ENCRYPTION_KEY = ""
  resetInstanceCipherForTests()
})

afterEach(() => {
  if (savedEnv.nodaro !== undefined) process.env.NODARO_ENCRYPTION_KEY = savedEnv.nodaro
  if (savedEnv.social !== undefined) process.env.SOCIAL_ENCRYPTION_KEY = savedEnv.social
  resetInstanceCipherForTests()
})

describe("generateSigningSecret", () => {
  it("is whsec_ plus 32 random bytes, url-safe", () => {
    const secret = generateSigningSecret()
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(generateSigningSecret()).not.toBe(secret)
  })
})

describe("sealSigningSecret / openSigningSecret", () => {
  it("round-trips, and the envelope does not carry the secret", () => {
    const secret = generateSigningSecret()
    const sealed = sealSigningSecret(secret, BINDING)
    expect(sealed).not.toContain(secret)
    expect(sealed).not.toContain(secret.slice("whsec_".length))
    expect(openSigningSecret(sealed, BINDING)).toBe(secret)
  })

  it("seals the same secret differently every time (a fresh nonce)", () => {
    const secret = generateSigningSecret()
    expect(sealSigningSecret(secret, BINDING)).not.toBe(sealSigningSecret(secret, BINDING))
  })

  it("does not open on another endpoint, owner or environment", () => {
    const sealed = sealSigningSecret(generateSigningSecret(), BINDING)
    expect(() => openSigningSecret(sealed, { ...BINDING, endpointId: "00000000-0000-4000-8000-0000000000e2" })).toThrow()
    expect(() => openSigningSecret(sealed, { ...BINDING, userId: "00000000-0000-4000-8000-000000000002" })).toThrow()
    expect(() => openSigningSecret(sealed, { ...BINDING, runtimeEnv: "staging" })).toThrow()
  })

  it("does not open under another instance key", () => {
    const sealed = sealSigningSecret(generateSigningSecret(), BINDING)
    mockConfig.NODARO_ENCRYPTION_KEY = "b".repeat(64)
    resetInstanceCipherForTests()
    expect(() => openSigningSecret(sealed, BINDING)).toThrow()
  })

  it("refuses to seal without an instance key", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    expect(() => sealSigningSecret(generateSigningSecret(), BINDING)).toThrow(/NODARO_ENCRYPTION_KEY/)
  })
})
