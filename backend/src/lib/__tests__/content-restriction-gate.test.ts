/**
 * The restriction gate (lib/content-restriction-gate.ts): every address in a
 * request's input data is read, one of ours decoded to its key, the set as
 * this server knows it now asked (never waited on), and the first restricted
 * key answered; another host's address, or no address, is nothing. The
 * decoder and the set are loaded only when an address is there to decode.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const fake = vi.hoisted(() => ({ restricted: new Set<string>(), setLoads: 0, decoderLoads: 0, asked: 0 }))

vi.mock("../content-restriction-set.js", () => {
  fake.setLoads++
  return {
    restrictedKeysNow: vi.fn(() => {
      fake.asked++
      return fake.restricted
    }),
  }
})
vi.mock("../content-restriction-address.js", () => {
  fake.decoderLoads++
  return {
    restrictedKeyOfAddress: (url: string) => (url.startsWith("https://cdn.example.test/") ? url.slice("https://cdn.example.test/".length).split("?")[0] : null),
  }
})

import { CONTENT_RESTRICTION_POLICY_ID, inputAddresses, restrictedInputKey } from "../content-restriction-gate.js"

beforeEach(() => {
  fake.restricted.clear()
  fake.asked = 0
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("inputAddresses", () => {
  it("reads every http(s) address, nested or listed, each once, and nothing else", () => {
    expect(inputAddresses({ prompt: "a cat", n: 3, refs: [{ url: "https://a.test/1" }, "http://b.test/2"], again: "https://a.test/1", off: "ftp://c.test" }))
      .toEqual(["https://a.test/1", "http://b.test/2"])
  })
})

describe("restrictedInputKey", () => {
  it("answers nothing for no input, and loads nothing for an input with no address", async () => {
    expect(await restrictedInputKey(null)).toBeNull()
    expect(await restrictedInputKey({ prompt: "a cat" })).toBeNull()
    expect(fake.decoderLoads).toBe(0)
    expect(fake.setLoads).toBe(0)
  })

  it("asks the set only for an address of ours, and answers nothing for one that is not restricted", async () => {
    expect(await restrictedInputKey({ imageUrl: "https://elsewhere.test/a.png" })).toBeNull()
    expect(fake.asked).toBe(0)
    expect(await restrictedInputKey({ imageUrl: "https://cdn.example.test/free.png" })).toBeNull()
    expect(fake.asked).toBe(1)
  })

  it("finds a restricted address anywhere in the input, decorated or nested", async () => {
    fake.restricted.add("videos/evidence.mp4")
    expect(await restrictedInputKey({ videoUrl: "https://cdn.example.test/videos/evidence.mp4?download=1" })).toBe("videos/evidence.mp4")
    expect(await restrictedInputKey({ refs: [{ url: "https://cdn.example.test/videos/evidence.mp4" }] })).toBe("videos/evidence.mp4")
  })

  it("logs a refusal with the key and the owner, server side", async () => {
    fake.restricted.add("videos/evidence.mp4")
    await restrictedInputKey({ videoUrl: "https://cdn.example.test/videos/evidence.mp4" }, { userId: "u-9" })
    expect(vi.mocked(console.warn).mock.calls.some(([line]) => String(line).includes("videos/evidence.mp4") && String(line).includes("u-9"))).toBe(true)
  })

  it("has a policy id of its own", () => {
    expect(CONTENT_RESTRICTION_POLICY_ID).toBe("platform:content-restriction")
  })
})
