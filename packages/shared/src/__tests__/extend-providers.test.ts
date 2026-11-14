import { describe, expect, it } from "vitest"
import {
  EXTEND_VIDEO_PROVIDERS,
  GROK_EXTEND_PROVIDER,
  PIXVERSE_V6_EXTEND_PROVIDER,
  extendHasSoundSwitch,
  getMaxVideoPromptChars,
  isCatalogExtendProvider,
  isGrokExtendProvider,
  isPixverseExtendProvider,
  isSeedanceExtendProvider,
  isTailExtendProvider,
} from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  buildVideoCreditModelIdentifier,
  catalogExtendCreditId,
  catalogExtendResolution,
  grokExtendCreditId,
  grokExtendSeconds,
  grokExtendWiredSourceResolution,
  pixverseExtendCreditId,
  pixverseExtendQuality,
  seedanceExtendCreditId,
  seedanceExtendResolution,
  tailExtendCreditId,
  tailExtendResolution,
} from "../credit-identifiers.js"

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const RESOLUTIONS = ["480p", "720p", "1080p"] as const

/**
 * Extend Video runs Seedance as two providers, one per model: Seedance 2.5
 * (4–30 s added) and Seedance 2.0 (4–15 s). Seedance 2.0 is priced on its own
 * rows, one per second added and resolution. Seedance 2.5 is charged per second
 * it sends and adds (the source's last 10 s, all of a shorter source): the
 * builder names the most a run of that length costs, the whole-window quote of
 * its resolution's two-second row, `seedance-2-5-extend:<res>:per-2s:<(10 + N) / 2>u`.
 */
const fullWindow = (seconds: number, res: string): string => `seedance-2-5-extend:${res}:per-2s:${(10 + seconds) / 2}u`
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

  it("prices Seedance 2.0 on its own rows, and Seedance 2.5 at its whole-window quote", () => {
    expect(tailExtendCreditId("seedance-2-5-extend", 8, "720p")).toBe("seedance-2-5-extend:720p:per-2s:9u")
    expect(tailExtendCreditId("seedance-2-0-extend", 8, "720p")).toBe("seedance-2-0-extend:8s:720p")
    expect(tailExtendCreditId("seedance-2-5-extend", 30, "1080p")).toBe("seedance-2-5-extend:1080p:per-2s:20u")
    expect(tailExtendCreditId("seedance-2-0-extend", 25, "480p")).toBe("seedance-2-0-extend:15s:480p")
    expect(tailExtendCreditId("seedance-2-5-extend")).toBe("seedance-2-5-extend:720p:per-2s:9u")
  })

  it("prices both Seedance models per second added", () => {
    expect(tailExtendCreditId("seedance-2-5-extend", 6, "480p")).toBe("seedance-2-5-extend:480p:per-2s:8u")
    expect(tailExtendCreditId("seedance-2-5-extend", 5, "480p")).toBe("seedance-2-5-extend:480p:per-2s:7.5u")
    expect(tailExtendCreditId("seedance-2-0-extend", 6, "480p")).toBe("seedance-2-0-extend:6s:480p")
    expect(tailExtendCreditId("seedance-2-0-extend", 10, "1080p")).toBe("seedance-2-0-extend:10s:1080p")
    expect(tailExtendCreditId("seedance-2-0-extend", 4, "720p")).toBe("seedance-2-0-extend:4s:720p")
    expect(tailExtendCreditId("seedance-2-0-extend")).toBe("seedance-2-0-extend:8s:720p")
  })

  it("snaps a length or a resolution the provider does not offer", () => {
    expect(tailExtendCreditId("seedance-2-5-extend", 2, "720p")).toBe(fullWindow(4, "720p"))
    expect(tailExtendCreditId("seedance-2-5-extend", 45, "720p")).toBe(fullWindow(30, "720p"))
    expect(tailExtendCreditId("seedance-2-5-extend", 8, "4k")).toBe(fullWindow(8, "720p"))
    expect(tailExtendCreditId("seedance-2-0-extend", 8, "4k")).toBe("seedance-2-0-extend:8s:720p")
    expect(tailExtendCreditId("seedance-2-0-extend", 2, "480p")).toBe("seedance-2-0-extend:4s:480p")
    expect(tailExtendCreditId("seedance-2-5-extend", 0, "480p")).toBe(fullWindow(8, "480p"))
  })

  it("renders at the resolution it is priced at: one the model offers, else 720p", () => {
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend"] as const) {
      for (const res of RESOLUTIONS) expect(tailExtendResolution(provider, res), `${provider} ${res}`).toBe(res)
      for (const res of [undefined, "4k", "360p", "", 1080, null]) {
        expect(tailExtendResolution(provider, res), `${provider} ${String(res)}`).toBe("720p")
      }
      // The id names exactly the resolution the run renders at.
      for (const res of [...RESOLUTIONS, undefined, "4k"]) {
        expect(tailExtendCreditId(provider, 8, res)).toBe(
          provider === "seedance-2-5-extend" ? fullWindow(8, tailExtendResolution(provider, res)) : `${provider}:8s:${tailExtendResolution(provider, res)}`,
        )
      }
    }
  })

  it("names only rows each provider is priced on, for any length and resolution", () => {
    // The Seedance 2.0 rows: every second of its window at three resolutions.
    const rows20 = new Set(range(4, 15).flatMap((n) => RESOLUTIONS.map((r) => `seedance-2-0-extend:${n}s:${r}`)))
    // Seedance 2.5: the whole-window quote of every second of its window at three resolutions.
    const rows25 = new Set(range(4, 30).flatMap((n) => RESOLUTIONS.map((r) => fullWindow(n, r))))
    for (const res of [...RESOLUTIONS, undefined, "4k"]) {
      for (const duration of [undefined, ...range(-1, 35)]) {
        expect(rows20.has(tailExtendCreditId("seedance-2-0-extend", duration, res)), `2.0 ${duration}s ${res}`).toBe(true)
        expect(rows25.has(tailExtendCreditId("seedance-2-5-extend", duration, res)), `2.5 ${duration}s ${res}`).toBe(true)
      }
    }
  })

  it("the generic video builder prices a Seedance extend through the extend builder, never a bare unpriced id", () => {
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend"] as const) {
      for (const duration of [undefined, 1, 6, 12, 25, 45, "12"]) {
        for (const res of [undefined, "480p", "720p", "1080p", "4k"]) {
          expect(buildVideoCreditModelIdentifier(provider, duration, undefined, undefined, undefined, res), `${provider} ${duration} ${res}`)
            .toBe(tailExtendCreditId(provider, duration, res))
        }
      }
    }
    // The retired id is priced as the provider it runs as.
    expect(buildVideoCreditModelIdentifier("seedance-2-extend", 12, undefined, undefined, undefined, "1080p")).toBe("seedance-2-5-extend:1080p:per-2s:11u")
    expect(buildVideoCreditModelIdentifier("seedance-2-extend")).toBe("seedance-2-5-extend:720p:per-2s:9u")
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
      // The retired provider id is never listed (sent as a provider, it runs and bills as Seedance 2.5).
      expect(entry.pricing.map((p) => p.identifier), id).not.toContain("seedance-2-extend")
    }
    // Seedance 2.0 lists the rows its default length is priced on, the default run's first.
    const ids20 = MODEL_CATALOG["seedance-2-0-extend"]!.pricing.map((p) => p.identifier)
    for (const res of RESOLUTIONS) expect(ids20, res).toContain(tailExtendCreditId("seedance-2-0-extend", 8, res))
    expect(ids20[0]).toBe(tailExtendCreditId("seedance-2-0-extend"))
    // Seedance 2.5 is charged per second sent and added (decided 2026-11-12): it
    // lists its default run (8 s added to a source of 10 s or more: 9 units of
    // each resolution's two-second rate row) as whole-run quote ids, 720p first.
    expect(MODEL_CATALOG["seedance-2-5-extend"]!.pricing.map((p) => p.identifier)).toEqual([
      "seedance-2-5-extend:720p:per-2s:9u",
      "seedance-2-5-extend:480p:per-2s:9u",
      "seedance-2-5-extend:1080p:per-2s:9u",
    ])
    // Its default run is the builder's default.
    expect(MODEL_CATALOG["seedance-2-5-extend"]!.pricing[0]!.identifier).toBe(tailExtendCreditId("seedance-2-5-extend"))
  })
})

/**
 * Kling 4 extends any video with the same tail recipe as Seedance (the
 * source's last frame opens the new footage, its last seconds ride as
 * `@video_1`, then the two are stitched): `kling-4-extend`, 3–30 s added at
 * 720p or 1080p, priced on its own rows.
 */
describe("Kling 4 Extend Video provider", () => {
  const KLING_RESOLUTIONS = ["720p", "1080p"] as const

  it("lists Kling 4 right after the two Seedance extend providers", () => {
    const at = EXTEND_VIDEO_PROVIDERS.indexOf("kling-4-extend")
    expect(at).toBeGreaterThan(-1)
    expect(EXTEND_VIDEO_PROVIDERS[at - 1]).toBe("seedance-2-0-extend")
  })

  it("is a tail-recipe extend provider, but no Seedance one (its levers are its own)", () => {
    expect(isTailExtendProvider("kling-4-extend")).toBe(true)
    expect(isSeedanceExtendProvider("kling-4-extend")).toBe(false)
    expect(isTailExtendProvider("kling-4")).toBe(false)
  })

  it("offers 3–30 s and 720p/1080p on Kling 4, in a catalog entry of its own", () => {
    const entry = MODEL_CATALOG["kling-4-extend"]!
    expect(entry.modes).toEqual(["extend"])
    expect(entry.maker).toBe("kuaishou")
    expect(entry.durations).toEqual(range(3, 30))
    expect(entry.resolutions).toEqual([...KLING_RESOLUTIONS])
    // Its default run is Kling 4's own default length.
    expect(entry.defaultDuration).toBe(MODEL_CATALOG["kling-4"]!.defaultDuration)
    expect(entry.pricing[0]!.identifier).toBe(tailExtendCreditId("kling-4-extend"))
    expect(entry.pricing[0]!.identifier).toBe("kling-4-extend:5s:720p")
  })

  it("prices every length and resolution on its own rows, snapping what it does not offer", () => {
    expect(tailExtendCreditId("kling-4-extend", 5, "720p")).toBe("kling-4-extend:5s:720p")
    expect(tailExtendCreditId("kling-4-extend", 30, "1080p")).toBe("kling-4-extend:30s:1080p")
    expect(tailExtendCreditId("kling-4-extend", 3, "1080p")).toBe("kling-4-extend:3s:1080p")
    expect(tailExtendCreditId("kling-4-extend", 2, "720p")).toBe("kling-4-extend:3s:720p")
    expect(tailExtendCreditId("kling-4-extend", 45, "720p")).toBe("kling-4-extend:30s:720p")
    // Kling 4 renders no 480p: a run naming it is priced, and renders, at 720p.
    expect(tailExtendCreditId("kling-4-extend", 8, "480p")).toBe("kling-4-extend:8s:720p")
    expect(tailExtendResolution("kling-4-extend", "480p")).toBe("720p")
    expect(tailExtendResolution("kling-4-extend", "1080p")).toBe("1080p")
    const rows = new Set(range(3, 30).flatMap((n) => KLING_RESOLUTIONS.map((r) => `kling-4-extend:${n}s:${r}`)))
    for (const res of [...KLING_RESOLUTIONS, undefined, "480p", "4k"]) {
      for (const duration of [undefined, ...range(-1, 35)]) {
        expect(rows.has(tailExtendCreditId("kling-4-extend", duration, res)), `${duration}s ${res}`).toBe(true)
      }
    }
  })

  it("the generic video builder prices a Kling 4 extend on its own rows", () => {
    for (const duration of [undefined, 1, 5, 12, 30, 45, "12"]) {
      for (const res of [undefined, "480p", "720p", "1080p"]) {
        expect(buildVideoCreditModelIdentifier("kling-4-extend", duration, undefined, undefined, undefined, res), `${duration} ${res}`)
          .toBe(tailExtendCreditId("kling-4-extend", duration, res))
      }
    }
  })
})

describe("the tail-recipe extend providers", () => {
  it("are Seedance 2.5, Seedance 2.0 and Kling 4", () => {
    expect(EXTEND_VIDEO_PROVIDERS.filter(isTailExtendProvider)).toEqual(["seedance-2-5-extend", "seedance-2-0-extend", "kling-4-extend"])
    expect(isTailExtendProvider("seedance-2-extend")).toBe(false)
    expect(isTailExtendProvider("veo-extend")).toBe(false)
    expect(isTailExtendProvider(undefined)).toBe(false)
    expect(isTailExtendProvider("toString")).toBe(false)
  })

  it("the earlier Seedance-only names still answer, as the tail builders do (published API)", () => {
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend"] as const) {
      for (const res of [undefined, "480p", "1080p", "4k"]) {
        expect(seedanceExtendCreditId(provider, 12, res)).toBe(tailExtendCreditId(provider, 12, res))
        expect(seedanceExtendResolution(provider, res)).toBe(tailExtendResolution(provider, res))
      }
    }
  })
})

/**
 * PixVerse V6 extends any video natively: the whole source goes in, and the
 * same clip comes back with the new seconds joined on (the worker keeps only
 * those). `pixverse-v6-extend`: 1–15 s added at 360p / 540p / 720p / 1080p,
 * with a sound switch, priced on its own rows (`:audio` with sound).
 */
describe("PixVerse V6 Extend Video provider", () => {
  const QUALITIES = ["360p", "540p", "720p", "1080p"] as const

  it("is listed after Kling 4, and is no tail recipe", () => {
    const at = EXTEND_VIDEO_PROVIDERS.indexOf("pixverse-v6-extend")
    expect(at).toBeGreaterThan(-1)
    expect(EXTEND_VIDEO_PROVIDERS[at - 1]).toBe("kling-4-extend")
    expect(PIXVERSE_V6_EXTEND_PROVIDER).toBe("pixverse-v6-extend")
    expect(isPixverseExtendProvider("pixverse-v6-extend")).toBe(true)
    expect(isPixverseExtendProvider("pixverse-v6-max")).toBe(false)
    expect(isPixverseExtendProvider(undefined)).toBe(false)
    expect(isTailExtendProvider("pixverse-v6-extend")).toBe(false)
    expect(isSeedanceExtendProvider("pixverse-v6-extend")).toBe(false)
  })

  it("is a catalog extend provider, as the tail recipes are; VEO, Runway and LTX are not", () => {
    expect(EXTEND_VIDEO_PROVIDERS.filter(isCatalogExtendProvider)).toEqual([
      "seedance-2-5-extend", "seedance-2-0-extend", "kling-4-extend", "pixverse-v6-extend",
    ])
    for (const p of ["veo-extend", "runway-extend", "ltx-2.3-pro", "seedance-2-extend", "toString", undefined]) {
      expect(isCatalogExtendProvider(p), String(p)).toBe(false)
    }
  })

  it("has a sound switch, as Seedance does; Kling 4 has none", () => {
    expect(EXTEND_VIDEO_PROVIDERS.filter(extendHasSoundSwitch)).toEqual(["seedance-2-5-extend", "seedance-2-0-extend", "pixverse-v6-extend"])
  })

  it("offers 1–15 s and 360p–1080p in a catalog entry of its own, its default row first", () => {
    const entry = MODEL_CATALOG["pixverse-v6-extend"]!
    expect(entry.modes).toEqual(["extend"])
    expect(entry.maker).toBe("pixverse")
    expect(entry.durations).toEqual(range(1, 15))
    expect(entry.defaultDuration).toBe(5)
    expect(entry.resolutions).toEqual([...QUALITIES])
    expect(entry.pricing[0]!.identifier).toBe(pixverseExtendCreditId())
    expect(entry.pricing[0]!.identifier).toBe("pixverse-v6-extend:5s:720p:audio")
  })

  it("takes PixVerse's prompt limit, 5000 characters", () => {
    expect(getMaxVideoPromptChars("pixverse-v6-extend")).toBe(5000)
  })

  it("renders a quality it offers as asked; 480p at the nearest it offers, 540p; anything else at 720p", () => {
    for (const q of QUALITIES) expect(pixverseExtendQuality(q)).toBe(q)
    expect(pixverseExtendQuality("480p")).toBe("540p")
    for (const other of [undefined, "", "4k", "2160p", "1080P", 720, null]) {
      expect(pixverseExtendQuality(other), String(other)).toBe("720p")
    }
  })

  it("prices the seconds added, the quality and the sound on its own rows, sound on unless turned off", () => {
    expect(pixverseExtendCreditId(5, "540p", true)).toBe("pixverse-v6-extend:5s:540p:audio")
    expect(pixverseExtendCreditId(5, "540p", false)).toBe("pixverse-v6-extend:5s:540p")
    expect(pixverseExtendCreditId(5, "540p")).toBe("pixverse-v6-extend:5s:540p:audio")
    expect(pixverseExtendCreditId(15, "1080p", false)).toBe("pixverse-v6-extend:15s:1080p")
    expect(pixverseExtendCreditId(1, "360p", false)).toBe("pixverse-v6-extend:1s:360p")
    expect(pixverseExtendCreditId(undefined, undefined, undefined)).toBe("pixverse-v6-extend:5s:720p:audio")
    expect(pixverseExtendCreditId(8, "480p", false)).toBe("pixverse-v6-extend:8s:540p")
    expect(pixverseExtendCreditId(40, "4k", false)).toBe("pixverse-v6-extend:15s:720p")
    // Every id it can name is one of its 120 rows.
    const rows = new Set(range(1, 15).flatMap((n) => QUALITIES.flatMap((q) => [`pixverse-v6-extend:${n}s:${q}`, `pixverse-v6-extend:${n}s:${q}:audio`])))
    expect(rows.size).toBe(120)
    for (const res of [...QUALITIES, undefined, "480p", "4k"]) {
      for (const duration of [undefined, "7", ...range(-1, 20)]) {
        for (const sound of [true, false, undefined]) {
          expect(rows.has(pixverseExtendCreditId(duration, res, sound)), `${duration}s ${res} ${sound}`).toBe(true)
        }
      }
    }
  })

  it("the catalog-extend builders answer for PixVerse and for every tail recipe alike", () => {
    expect(catalogExtendCreditId("pixverse-v6-extend", 5, "540p", false)).toBe(pixverseExtendCreditId(5, "540p", false))
    expect(catalogExtendResolution("pixverse-v6-extend", "480p")).toBe("540p")
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend", "kling-4-extend"] as const) {
      for (const res of [undefined, "480p", "540p", "1080p", "4k"]) {
        // A tail recipe has no priced sound switch: its row ignores it.
        for (const sound of [true, false, undefined]) {
          expect(catalogExtendCreditId(provider, 12, res, sound)).toBe(tailExtendCreditId(provider, 12, res))
        }
        expect(catalogExtendResolution(provider, res)).toBe(tailExtendResolution(provider, res))
      }
    }
  })

  it("the generic video builder prices a PixVerse extend on its own rows, reading generateAudio then sound", () => {
    for (const duration of [undefined, 1, 5, 12, 15, 30, "12"]) {
      for (const res of [undefined, "480p", "540p", "1080p"]) {
        expect(buildVideoCreditModelIdentifier("pixverse-v6-extend", duration, undefined, undefined, undefined, res), `${duration} ${res}`)
          .toBe(pixverseExtendCreditId(duration, res, true))
        expect(buildVideoCreditModelIdentifier("pixverse-v6-extend", duration, { generateAudio: false }, undefined, undefined, res))
          .toBe(pixverseExtendCreditId(duration, res, false))
        expect(buildVideoCreditModelIdentifier("pixverse-v6-extend", duration, false, undefined, undefined, res))
          .toBe(pixverseExtendCreditId(duration, res, false))
      }
    }
  })
})

/**
 * Grok extends only its own clips (a Grok Imagine text-to-video or
 * image-to-video run), by the source's task. It adds 6 or 10 seconds, at the
 * source's resolution — never a resolution the request names — so it is no
 * catalog extend (whose resolution is a lever).
 */
describe("Grok Extend Video provider", () => {
  const ROWS = ["grok-extend:6s:480p", "grok-extend:6s:720p", "grok-extend:10s:480p", "grok-extend:10s:720p"]

  it("is listed last, and is neither a tail recipe nor a catalog extend", () => {
    expect(EXTEND_VIDEO_PROVIDERS[EXTEND_VIDEO_PROVIDERS.length - 1]).toBe("grok-extend")
    expect(EXTEND_VIDEO_PROVIDERS[EXTEND_VIDEO_PROVIDERS.length - 2]).toBe("pixverse-v6-extend")
    expect(GROK_EXTEND_PROVIDER).toBe("grok-extend")
    expect(isGrokExtendProvider("grok-extend")).toBe(true)
    for (const p of ["grok", "grok-i2v", "grok-imagine-video-1.5", "pixverse-v6-extend", "veo-extend", undefined]) {
      expect(isGrokExtendProvider(p), String(p)).toBe(false)
    }
    expect(isTailExtendProvider("grok-extend")).toBe(false)
    expect(isCatalogExtendProvider("grok-extend")).toBe(false)
    expect(extendHasSoundSwitch("grok-extend")).toBe(false)
  })

  it("offers 6 or 10 s in a catalog entry of its own, with no resolution lever, its unknown-source row first", () => {
    const entry = MODEL_CATALOG["grok-extend"]!
    expect(entry.modes).toEqual(["extend"])
    expect(entry.maker).toBe("xai")
    expect(entry.durations).toEqual([6, 10])
    expect(entry.defaultDuration).toBe(6)
    // The source decides the resolution: none is offered as a choice.
    expect(entry.resolutions).toBeUndefined()
    expect(entry.pricing.map((p) => p.identifier).sort()).toEqual([...ROWS].sort())
    // Led by the row a run is quoted at before its source is known: 6 s, the dearer 720p.
    expect(entry.pricing[0]!.identifier).toBe(grokExtendCreditId())
    expect(entry.pricing[0]!.identifier).toBe("grok-extend:6s:720p")
  })

  it("prices the seconds added at the source's resolution; an unknown source at 720p, never below", () => {
    expect(grokExtendCreditId(6, "480p")).toBe("grok-extend:6s:480p")
    expect(grokExtendCreditId(10, "480p")).toBe("grok-extend:10s:480p")
    expect(grokExtendCreditId(6, "720p")).toBe("grok-extend:6s:720p")
    expect(grokExtendCreditId(10, "720p")).toBe("grok-extend:10s:720p")
    expect(grokExtendCreditId("10", "480p")).toBe("grok-extend:10s:480p")
    // No length: its default, 6 s. A length it does not add snaps into 6 / 10.
    expect(grokExtendCreditId(undefined, "480p")).toBe("grok-extend:6s:480p")
    expect(grokExtendCreditId(8, "480p")).toBe("grok-extend:6s:480p")
    expect(grokExtendCreditId(15, "720p")).toBe("grok-extend:10s:720p")
    // A source whose resolution is not known is priced at the dearer row.
    for (const res of [undefined, "", "720P", "1080p", "540p", 480]) {
      expect(grokExtendCreditId(6, res), String(res)).toBe("grok-extend:6s:720p")
    }
    expect(grokExtendSeconds(undefined)).toBe(6)
    expect(grokExtendSeconds(10)).toBe(10)
    expect(grokExtendSeconds("10")).toBe(10)
    expect(grokExtendSeconds(7)).toBe(6)
    // Every id it can name is one of its four rows.
    for (const duration of [undefined, "7", ...range(-1, 20)]) {
      for (const res of [undefined, "480p", "720p", "1080p", "4k"]) {
        expect(ROWS, `${duration}s ${res}`).toContain(grokExtendCreditId(duration, res))
      }
    }
  })

  it("the generic video builder never prices a Grok extend at a resolution it is handed", () => {
    for (const res of [undefined, "480p", "720p"]) {
      expect(buildVideoCreditModelIdentifier("grok-extend", 10, undefined, undefined, undefined, res), String(res)).toBe("grok-extend:10s:720p")
    }
  })

  it("quotes 480p only for a wired Grok Imagine video node set to 480p; anything else at 720p", () => {
    const video = (provider: unknown, resolution?: unknown, type = "generate-video") => ({ id: "src", type, data: { provider, ...(resolution !== undefined ? { resolution } : {}) } })
    const ext = { id: "ext", type: "extend-video", data: { provider: "grok-extend" } }
    const wire = (targetHandle: string | null = "video") => [{ source: "src", target: "ext", targetHandle }]
    for (const type of ["generate-video", "text-to-video", "image-to-video"]) {
      for (const provider of ["grok", "grok-i2v"]) {
        expect(grokExtendWiredSourceResolution("ext", [ext, video(provider, "480p", type)], wire()), `${type} ${provider}`).toBe("480p")
        expect(grokExtendWiredSourceResolution("ext", [ext, video(provider, " 480P ", type)], wire())).toBe("480p")
        // Unset: Grok may render it at either, so the dearer.
        for (const res of [undefined, "720p", "1080p", ""]) {
          expect(grokExtendWiredSourceResolution("ext", [ext, video(provider, res, type)], wire()), `${type} ${provider} ${res}`).toBe("720p")
        }
      }
    }
    // A legacy wire with no handle reads the same.
    expect(grokExtendWiredSourceResolution("ext", [ext, video("grok-i2v", "480p")], wire(null))).toBe("480p")
    // Not a Grok Imagine video node: another model, Grok 1.5, an upload, a Grok image.
    for (const src of [video("seedance-2-5", "480p"), video("grok-imagine-video-1.5", "480p"), video(undefined, "480p", "upload-video"), video("grok", "480p", "generate-image")]) {
      expect(grokExtendWiredSourceResolution("ext", [ext, src], wire())).toBe("720p")
    }
    // Nothing wired, or a wire on another input.
    expect(grokExtendWiredSourceResolution("ext", [ext], [])).toBe("720p")
    expect(grokExtendWiredSourceResolution("ext", [ext, video("grok-i2v", "480p")], wire("prompt"))).toBe("720p")
  })

  // The charge reads the resolution the SOURCE's job recorded (`input_data.resolution`; none: the
  // KIE config's pin, else Grok's own 480p default). Every lane that lands a take records the task
  // that made it and that recorded resolution on the result row, so the quote reads the same fact,
  // off the take the node's task names (the clip the run extends): `480p` → the 480p row; anything
  // else, or none → the 720p row, never below the charge.
  describe("a Grok node that already made a clip: quoted from the resolution its job recorded, not from its setting", () => {
    const ext = { id: "ext", type: "extend-video", data: { provider: "grok-extend" } }
    const wire = [{ source: "src", target: "ext", targetHandle: "video" }]
    type Row = { task?: string; recorded?: string; width?: number; height?: number }
    /** A Grok Imagine node holding task `t-latest`, set to `resolution`; its results newest first. */
    const ran = (rows: readonly Row[], resolution?: string, extra: Record<string, unknown> = {}) => ({
      id: "src",
      type: "generate-video",
      data: {
        provider: "grok-i2v",
        ...(resolution !== undefined ? { resolution } : {}),
        kieTaskId: "t-latest",
        generatedResults: rows.map((r, i) => ({
          url: `https://cdn.example/${i}.mp4`, jobId: `j${i}`,
          ...(r.task !== undefined ? { kieTaskId: r.task } : {}),
          ...(r.recorded !== undefined ? { recordedResolution: r.recorded } : {}),
          ...(r.width !== undefined ? { width: r.width, height: r.height } : {}),
        })),
        ...extra,
      },
    })
    const quote = (node: ReturnType<typeof ran>, rerunIds?: ReadonlySet<string>) => grokExtendWiredSourceResolution("ext", [ext, node], wire, rerunIds)

    it("the take the task names recorded 480p: 480p, whatever the node is set to now", () => {
      for (const resolution of ["480p", "720p", undefined]) {
        expect(quote(ran([{ task: "t-latest", recorded: "480p" }], resolution)), String(resolution)).toBe("480p")
      }
      // Case-insensitive, as the charge reads it.
      expect(quote(ran([{ task: "t-latest", recorded: "480P" }]))).toBe("480p")
    })

    it("recorded 720p (a node set to 480p since): 720p", () => {
      expect(quote(ran([{ task: "t-latest", recorded: "720p" }], "480p"))).toBe("720p")
    })

    it("the take names the task but recorded no resolution: 720p", () => {
      expect(quote(ran([{ task: "t-latest" }], "480p"))).toBe("720p")
    })

    it("the file's pixel size is never read: a 480p-sized file whose job recorded 720p is 720p (and a 720p-sized one recording 480p is 480p)", () => {
      expect(quote(ran([{ task: "t-latest", recorded: "720p", width: 854, height: 480 }], "480p"))).toBe("720p")
      expect(quote(ran([{ task: "t-latest", recorded: "480p", width: 1280, height: 720 }], "720p"))).toBe("480p")
      expect(quote(ran([{ task: "t-latest", width: 854, height: 480 }], "480p"))).toBe("720p")
    })

    it("no result names the node's task — its result deleted, results from before they recorded their task, or none at all: 720p", () => {
      for (const resolution of ["480p", "720p", undefined]) {
        // The newest (720p) result deleted; the node still holds its task.
        expect(quote(ran([{ task: "t-older", recorded: "480p" }], resolution)), String(resolution)).toBe("720p")
        // Results that recorded no task.
        expect(quote(ran([{ recorded: "480p" }, { width: 854, height: 480 }], resolution)), String(resolution)).toBe("720p")
        // A task with no result.
        expect(quote(ran([], resolution)), String(resolution)).toBe("720p")
      }
    })

    it("reads the take the task names — never the one only shown, nor the newest", () => {
      const node = ran([{ task: "t-older", recorded: "720p" }, { task: "t-latest", recorded: "480p" }], "720p", { activeResultIndex: 0 })
      expect(quote(node)).toBe("480p")
      // An edit landed after it (a result with no task of its own).
      expect(quote(ran([{ recorded: "720p" }, { task: "t-latest", recorded: "480p" }], "720p"))).toBe("480p")
    })

    it("a node that has not run quotes its setting: 480p as set, else 720p", () => {
      const fresh = (resolution?: string) => ({ id: "src", type: "generate-video", data: { provider: "grok", ...(resolution !== undefined ? { resolution } : {}) } })
      expect(grokExtendWiredSourceResolution("ext", [ext, fresh("480p")], wire)).toBe("480p")
      expect(grokExtendWiredSourceResolution("ext", [ext, fresh()], wire)).toBe("720p")
      expect(grokExtendWiredSourceResolution("ext", [ext, fresh("720p")], wire)).toBe("720p")
    })

    it("a node that makes a new clip in the quoted run is quoted at its setting (the clip it will make)", () => {
      // Recorded 480p, now set to 720p, and it runs again: the run extends the new 720p clip.
      expect(quote(ran([{ task: "t-latest", recorded: "480p" }], "720p"), new Set(["src", "ext"]))).toBe("720p")
      // Recorded 720p, now set to 480p, and it runs again: the new clip is 480p.
      expect(quote(ran([{ task: "t-latest", recorded: "720p" }], "480p"), new Set(["src", "ext"]))).toBe("480p")
      // A frozen node does not run again: it hands on the clip it holds.
      expect(quote(ran([{ task: "t-latest", recorded: "720p" }], "480p", { skipped: true }), new Set(["src", "ext"]))).toBe("720p")
      // Outside the run's nodes (Run from here on the extension): the clip it holds.
      expect(quote(ran([{ task: "t-latest", recorded: "720p" }], "480p"), new Set(["ext"]))).toBe("720p")
    })
  })
})
