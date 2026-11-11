import { describe, expect, it } from "vitest"
import { EXTEND_VIDEO_PROVIDERS, isSeedanceExtendProvider } from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"
import { buildVideoCreditModelIdentifier, seedanceExtendCreditId, seedanceExtendResolution } from "../credit-identifiers.js"

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const RESOLUTIONS = ["480p", "720p", "1080p"] as const

/**
 * Extend Video runs Seedance as two providers, one per model: Seedance 2.5
 * (4–30 s added) and Seedance 2.0 (4–15 s). Each is priced on its own rows,
 * one per second added and resolution.
 */
describe("Seedance Extend Video providers", () => {
  it("lists Seedance 2.5 and 2.0 as two extend providers", () => {
    expect(EXTEND_VIDEO_PROVIDERS).toEqual(expect.arrayContaining(["seedance-2-5-extend", "seedance-2-0-extend"]))
    expect(EXTEND_VIDEO_PROVIDERS).not.toContain("seedance-2-extend")
  })

  it("tells the two Seedance extend providers from every other value", () => {
    expect(isSeedanceExtendProvider("seedance-2-5-extend")).toBe(true)
    expect(isSeedanceExtendProvider("seedance-2-0-extend")).toBe(true)
    // The retired id is mapped to the provider it runs as before it is asked.
    expect(isSeedanceExtendProvider("seedance-2-extend")).toBe(false)
    expect(isSeedanceExtendProvider("veo-extend")).toBe(false)
    expect(isSeedanceExtendProvider("seedance-2-5")).toBe(false)
    expect(isSeedanceExtendProvider(undefined)).toBe(false)
  })

  it("prices each Seedance extend on its own rows", () => {
    expect(seedanceExtendCreditId("seedance-2-5-extend", 8, "720p")).toBe("seedance-2-5-extend:8s:720p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 8, "720p")).toBe("seedance-2-0-extend:8s:720p")
    expect(seedanceExtendCreditId("seedance-2-5-extend", 30, "1080p")).toBe("seedance-2-5-extend:30s:1080p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 25, "480p")).toBe("seedance-2-0-extend:15s:480p")
    expect(seedanceExtendCreditId("seedance-2-5-extend")).toBe("seedance-2-5-extend:8s:720p")
  })

  it("prices both Seedance models per second added", () => {
    expect(seedanceExtendCreditId("seedance-2-5-extend", 6, "480p")).toBe("seedance-2-5-extend:6s:480p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 6, "480p")).toBe("seedance-2-0-extend:6s:480p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 10, "1080p")).toBe("seedance-2-0-extend:10s:1080p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 4, "720p")).toBe("seedance-2-0-extend:4s:720p")
    expect(seedanceExtendCreditId("seedance-2-0-extend")).toBe("seedance-2-0-extend:8s:720p")
  })

  it("snaps a length or a resolution the provider does not offer", () => {
    expect(seedanceExtendCreditId("seedance-2-5-extend", 2, "720p")).toBe("seedance-2-5-extend:4s:720p")
    expect(seedanceExtendCreditId("seedance-2-5-extend", 45, "720p")).toBe("seedance-2-5-extend:30s:720p")
    expect(seedanceExtendCreditId("seedance-2-5-extend", 8, "4k")).toBe("seedance-2-5-extend:8s:720p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 8, "4k")).toBe("seedance-2-0-extend:8s:720p")
    expect(seedanceExtendCreditId("seedance-2-0-extend", 2, "480p")).toBe("seedance-2-0-extend:4s:480p")
    expect(seedanceExtendCreditId("seedance-2-5-extend", 0, "480p")).toBe("seedance-2-5-extend:8s:480p")
  })

  it("renders at the resolution it is priced at: one the model offers, else 720p", () => {
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend"] as const) {
      for (const res of RESOLUTIONS) expect(seedanceExtendResolution(provider, res), `${provider} ${res}`).toBe(res)
      for (const res of [undefined, "4k", "360p", "", 1080, null]) {
        expect(seedanceExtendResolution(provider, res), `${provider} ${String(res)}`).toBe("720p")
      }
      // The id names exactly the resolution the run renders at.
      for (const res of [...RESOLUTIONS, undefined, "4k"]) {
        expect(seedanceExtendCreditId(provider, 8, res)).toBe(`${provider}:8s:${seedanceExtendResolution(provider, res)}`)
      }
    }
  })

  it("names only rows each provider is priced on, for any length and resolution", () => {
    // The Seedance 2.0 rows: every second of its window at three resolutions.
    const rows20 = new Set(range(4, 15).flatMap((n) => RESOLUTIONS.map((r) => `seedance-2-0-extend:${n}s:${r}`)))
    // The Seedance 2.5 rows: every second of its window at three resolutions.
    const rows25 = new Set(range(4, 30).flatMap((n) => RESOLUTIONS.map((r) => `seedance-2-5-extend:${n}s:${r}`)))
    for (const res of [...RESOLUTIONS, undefined, "4k"]) {
      for (const duration of [undefined, ...range(-1, 35)]) {
        expect(rows20.has(seedanceExtendCreditId("seedance-2-0-extend", duration, res)), `2.0 ${duration}s ${res}`).toBe(true)
        expect(rows25.has(seedanceExtendCreditId("seedance-2-5-extend", duration, res)), `2.5 ${duration}s ${res}`).toBe(true)
      }
    }
  })

  it("the generic video builder prices a Seedance extend on its own rows, never a bare unpriced id", () => {
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend"] as const) {
      for (const duration of [undefined, 1, 6, 12, 25, 45, "12"]) {
        for (const res of [undefined, "480p", "720p", "1080p", "4k"]) {
          expect(buildVideoCreditModelIdentifier(provider, duration, undefined, undefined, undefined, res), `${provider} ${duration} ${res}`)
            .toBe(seedanceExtendCreditId(provider, duration, res))
        }
      }
    }
    // The retired id is priced as the provider it runs as.
    expect(buildVideoCreditModelIdentifier("seedance-2-extend", 12, undefined, undefined, undefined, "1080p")).toBe("seedance-2-5-extend:12s:1080p")
    expect(buildVideoCreditModelIdentifier("seedance-2-extend")).toBe("seedance-2-5-extend:8s:720p")
  })

  it("catalogs each with its own window", () => {
    expect(MODEL_CATALOG["seedance-2-5-extend"]?.durations).toEqual(range(4, 30))
    expect(MODEL_CATALOG["seedance-2-0-extend"]?.durations).toEqual(range(4, 15))
    expect(MODEL_CATALOG["seedance-2-extend"]).toBeUndefined()
    for (const id of ["seedance-2-5-extend", "seedance-2-0-extend"] as const) {
      const entry = MODEL_CATALOG[id]!
      expect(entry.modes).toEqual(["extend"])
      expect(entry.maker).toBe("bytedance")
      expect(entry.defaultDuration).toBe(8)
      expect(entry.resolutions).toEqual([...RESOLUTIONS])
      // Each catalog entry lists the rows its default length is priced on.
      const ids = entry.pricing.map((p) => p.identifier)
      for (const res of RESOLUTIONS) expect(ids, `${id} ${res}`).toContain(seedanceExtendCreditId(id, 8, res))
      // The first row is the default run's price; the retired provider id is
      // never listed (sent as a provider, it runs and bills as Seedance 2.5).
      expect(entry.pricing[0]!.identifier, id).toBe(seedanceExtendCreditId(id))
      expect(ids, id).not.toContain("seedance-2-extend")
    }
  })
})
