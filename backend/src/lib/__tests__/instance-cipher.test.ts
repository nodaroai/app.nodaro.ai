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
  boundCipher,
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

describe("boundCipher — a per-purpose subkey with the envelope bound to its context", () => {
  it("round-trips only under the same purpose AND the same associated data", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    const staging = boundCipher("accounts:staging")
    const sealed = staging.encrypt("session-payload", "acme|user|42")

    expect(sealed).not.toContain("session-payload")
    expect(staging.decrypt(sealed, "acme|user|42")).toBe("session-payload")
    // Moved onto another row: refused.
    expect(() => staging.decrypt(sealed, "acme|user|43")).toThrow()
    // Opened by another purpose (another environment's subkey): refused.
    expect(() => boundCipher("accounts:production").decrypt(sealed, "acme|user|42")).toThrow()
  })

  it("is not the instance key itself — the plain cipher cannot open a bound envelope", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    const sealed = boundCipher("accounts:staging").encrypt("x", "ctx")
    expect(() => decryptSecret(sealed)).toThrow()
  })

  it("refuses a truncated envelope or tag rather than accepting a short GCM tag", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    const cipher = boundCipher("p")
    const sealed = Buffer.from(cipher.encrypt("payload", "ctx"), "base64")
    expect(() => cipher.decrypt(sealed.subarray(0, 20).toString("base64"), "ctx")).toThrow()
    expect(() => cipher.decrypt(sealed.subarray(0, 12 + 16).toString("base64"), "ctx")).toThrow()
  })

  it("follows the instance key: another key cannot open it, and no key is the named error", () => {
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_A
    const sealed = boundCipher("p").encrypt("payload", "ctx")
    mockConfig.NODARO_ENCRYPTION_KEY = KEY_B
    resetInstanceCipherForTests()
    expect(() => boundCipher("p").decrypt(sealed, "ctx")).toThrow()
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    expect(() => boundCipher("p").encrypt("x", "ctx")).toThrow(EncryptionKeyMissingError)
  })
})
