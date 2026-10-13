/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The signals run on the boot path of every Nodaro app, on a page that must
 * render even when every input they want is missing — so the degraded case
 * is the important one. jsdom is a fair model of a hardened browser: no
 * WebGL context, no `deviceMemory`, a zeroed `screen`.
 *
 * The device key here MUST equal the one the main app computes
 * (`frontend/src/ee/lib/device-key.ts`): the server compares them across
 * surfaces. The parity guard lives beside that file.
 */

const h = vi.hoisted(() => ({
  load: vi.fn(async (_options?: { monitoring?: boolean }) => ({
    get: async () => ({ visitorId: "visitor-1" }),
  })),
}))
vi.mock("@fingerprintjs/fingerprintjs", () => ({ load: h.load }))

import { collectSignupKeys, computeBrowserKey, computeDeviceKey, sha256Hex } from "../signup-signals.js"

const HEX64 = /^[0-9a-f]{64}$/

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"]
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("sha256Hex", () => {
  it("produces the standard digest", async () => {
    await expect(sha256Hex("hello")).resolves.toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })

  it("returns null rather than throwing when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", {})
    await expect(sha256Hex("hello")).resolves.toBeNull()
  })
})

describe("computeDeviceKey", () => {
  it("is a 64-character lowercase hex digest, stable across calls", async () => {
    const first = await computeDeviceKey()
    expect(first).toMatch(HEX64)
    await expect(computeDeviceKey()).resolves.toBe(first)
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
    vi.stubGlobal("crypto", {})
    await expect(computeDeviceKey()).resolves.toBeNull()
  })
})

describe("computeBrowserKey", () => {
  it("re-hashes FingerprintJS's visitorId to a SHA-256 hex, with its beacon off", async () => {
    const key = await computeBrowserKey()
    expect(key).toBe(await sha256Hex("visitor-1"))
    expect(h.load).toHaveBeenCalledWith({ monitoring: false })
  })

  it("is null when the agent yields nothing, throws, or is not installed", async () => {
    h.load.mockResolvedValueOnce({ get: async () => ({ visitorId: "" }) })
    await expect(computeBrowserKey()).resolves.toBeNull()
    h.load.mockRejectedValueOnce(new Error("Cannot find module"))
    await expect(computeBrowserKey()).resolves.toBeNull()
  })
})

describe("collectSignupKeys", () => {
  it("carries both keys when both resolve", async () => {
    const keys = await collectSignupKeys()
    expect(keys).toEqual({ browserKey: await sha256Hex("visitor-1"), deviceKey: await computeDeviceKey() })
  })

  it("sends whatever finished by the deadline — a slow fingerprint costs only its own key", async () => {
    // Real timers: the device digest resolves off the clock, so a faked
    // clock could reach the deadline before it lands.
    h.load.mockImplementationOnce(() => new Promise(() => {}))
    const keys = await collectSignupKeys(50)
    expect(keys.browserKey).toBeUndefined()
    expect(keys.deviceKey).toMatch(HEX64)
  })

  it("sends an empty object when nothing could be measured", async () => {
    vi.stubGlobal("crypto", {})
    await expect(collectSignupKeys()).resolves.toEqual({})
  })
})
