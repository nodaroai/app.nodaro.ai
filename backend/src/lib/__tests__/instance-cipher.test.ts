/**
 * One instance cipher for every secret the server stores for itself:
 * social OAuth tokens today, operator-supplied provider keys next. The key
 * comes from NODARO_ENCRYPTION_KEY, with SOCIAL_ENCRYPTION_KEY accepted as
 * the older name so no existing install re-encrypts anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODARO_ENCRYPTION_KEY: "", SOCIAL_ENCRYPTION_KEY: "" },
}))
vi.mock("../config.js", () => ({ config: mockConfig }))

import {
  decryptSecret,
  encryptSecret,
  encryptionKeySource,
  EncryptionKeyMissingError,
  resetInstanceCipherForTests,
} from "../instance-cipher.js"

const KEY_A = "a".repeat(64)
const KEY_B = "b".repeat(64)

beforeEach(() => {
  mockConfig.NODARO_ENCRYPTION_KEY = ""
  mockConfig.SOCIAL_ENCRYPTION_KEY = ""
  resetInstanceCipherForTests()
})

describe("instance cipher", () => {
  it("round-trips with NODARO_ENCRYPTION_KEY and reports the source", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    const sealed = encryptSecret("ndr_super_secret")
    expect(sealed).not.toContain("ndr_super_secret")
    expect(decryptSecret(sealed)).toBe("ndr_super_secret")
    expect(encryptionKeySource()).toBe("NODARO_ENCRYPTION_KEY")
  })

  it("accepts the older SOCIAL_ENCRYPTION_KEY name unchanged (no re-encrypt for existing installs)", () => {
    mockConfig.SOCIAL_ENCRYPTION_KEY = KEY_A
    const sealed = encryptSecret("telegram-token")
    expect(decryptSecret(sealed)).toBe("telegram-token")
    expect(encryptionKeySource()).toBe("SOCIAL_ENCRYPTION_KEY")
  })

  it("prefers the new name when both are set", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    mockConfig.SOCIAL_ENCRYPTION_KEY = KEY_B
    const sealed = encryptSecret("x")
    resetInstanceCipherForTests()
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    // Only KEY_B is left -> the envelope sealed with KEY_A must NOT open.
    expect(() => decryptSecret(sealed)).toThrow()
  })

  it("throws a named error when no key is configured, and says which vars to set", () => {
    expect(() => encryptSecret("x")).toThrow(EncryptionKeyMissingError)
    expect(() => encryptSecret("x")).toThrow(/NODARO_ENCRYPTION_KEY/)
    expect(encryptionKeySource()).toBeNull()
  })

  it("rejects a malformed key rather than silently using it", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = "too-short"
    expect(() => encryptSecret("x")).toThrow(/64-char hex/)
  })

  it("uses a fresh IV per call (identical plaintexts differ on the wire)", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"))
  })

  it("detects tampering (GCM tag) instead of returning garbage", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    const sealed = encryptSecret("payload")
    const buf = Buffer.from(sealed, "base64")
    buf[buf.length - 1] ^= 0xff
    expect(() => decryptSecret(buf.toString("base64"))).toThrow()
  })
})
