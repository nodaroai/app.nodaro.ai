import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The device key is computed on the boot path of a page that must render even
 * when every input it wants is missing, so the degraded case is the important
 * one. jsdom is a fair model of a hardened browser here: no WebGL context, no
 * `deviceMemory`, a zeroed `screen` — a key that only works on a permissive
 * browser would be worse than no key, because it would fail exactly on the
 * browsers an abuser reaches for.
 */

import { computeDeviceKey, sha256Hex } from "../device-key"

const HEX64 = /^[0-9a-f]{64}$/

beforeEach(() => {
  // jsdom implements getContext() as an unimplemented stub that logs on every
  // call; the key must survive a null context regardless. Same shape as
  // src/test/setup.ts's scrollIntoView override, kept local to this spec.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"]
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("computeDeviceKey", () => {
  it("is a 64-character lowercase hex digest", async () => {
    await expect(computeDeviceKey()).resolves.toMatch(HEX64)
  })

  it("is stable across calls on the same device", async () => {
    const first = await computeDeviceKey()
    const second = await computeDeviceKey()
    expect(first).toBe(second)
    expect(first).toMatch(HEX64)
  })

  it("moves when the hardware underneath it moves", async () => {
    const before = await computeDeviceKey()
    vi.stubGlobal("screen", { width: 3840, height: 2160, colorDepth: 30, pixelDepth: 30 })
    const after = await computeDeviceKey()
    expect(after).toMatch(HEX64)
    expect(after).not.toBe(before)
  })

  it("returns null rather than throwing when an attribute getter is blocked", async () => {
    vi.stubGlobal("screen", {
      get width(): number {
        throw new Error("blocked by a privacy extension")
      },
    })
    await expect(computeDeviceKey()).resolves.toBeNull()
  })

  it("returns null rather than throwing when crypto.subtle is unavailable", async () => {
    // An insecure origin has no SubtleCrypto at all.
    vi.stubGlobal("crypto", {})
    await expect(computeDeviceKey()).resolves.toBeNull()
  })
})

describe("sha256Hex", () => {
  it("produces the standard digest", async () => {
    await expect(sha256Hex("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })

  it("returns null rather than throwing when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {})
    await expect(sha256Hex("hello")).resolves.toBeNull()
  })
})
