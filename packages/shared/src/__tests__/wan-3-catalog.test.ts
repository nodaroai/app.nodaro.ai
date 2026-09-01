import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_PROVIDERS_REQUIRING_IMAGE,
  getVideoAudioCapability,
  defaultVideoAspectRatio,
  getMaxVideoPromptChars,
  WAN_3_PROVIDERS,
  isWan3Provider,
  WAN_3_DEFAULT_RESOLUTION,
  normalizeWan3Resolution,
  isSeedance2Provider,
  isMinimaxH3Provider,
  SEEDANCE_2_PROVIDERS,
  DURATION_PRICED_PROVIDERS,
  VIDEO_DURATION_TIERS,
  RESOLUTION_DURATION_PRICING,
  PRICING_DEFAULT_RESOLUTION,
  NATIVE_ADAPTIVE_ASPECT,
  SEEDANCE_2_R2V_MAX_AUDIO_SEC_BY_PROVIDER,
  GVP_SUPPORTED_PROVIDERS,
  GVP_EXTEND_PROVIDERS,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

const WAN_3_IDS = ["wan-3", "wan-3-prime"] as const
const DURATIONS_2_TO_30 = Array.from({ length: 29 }, (_, i) => i + 2)

describe("wan-3 / wan-3-prime catalog", () => {
  for (const id of WAN_3_IDS) {
    describe(id, () => {
      const entry = MODEL_CATALOG[id]

      it("exists with both video modes under ONE id (no t2v twin, no alias)", () => {
        expect(entry).toBeDefined()
        expect(entry.kind).toBe("video")
        expect([...entry.modes].sort()).toEqual(["i2v", "t2v"])
        expect(entry.series).toBe("Wan")
        expect(entry.family).toBe("Alibaba")
      })

      it("lists resolutions ASCENDING — the default is declared, not smuggled in at index 0", () => {
        // Every video entry in the catalog is ascending, and three unrelated
        // consumers read index 0 (the frontend fail-safe snap, payload-builder's
        // resolution fill, the GVP display order). The 720p billing/render
        // default lives in PRICING_DEFAULT_RESOLUTION instead.
        expect(entry.resolutions).toEqual(["480p", "720p", "1080p"])
        expect(PRICING_DEFAULT_RESOLUTION[id]).toBe("720p")
      })

      it("offers every integer second 2-30 (`-1` model-chosen duration is NOT exposed)", () => {
        expect(entry.durations).toEqual(DURATIONS_2_TO_30)
        expect(entry.durations).not.toContain(-1)
      })

      it("uses the Wan 3.0 six-ratio set: adaptive first, NO 21:9", () => {
        expect(entry.aspectRatios).toEqual(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"])
        // Reusing VIDEO_RATIOS_SEEDANCE_2 would have offered 21:9, which the
        // Wan 3.0 enum rejects at request time.
        expect(entry.aspectRatios).not.toContain("21:9")
      })

      it("declares end-frame + audio + reference-image, and deliberately NOT video-reference", () => {
        expect(entry.features).toEqual(expect.arrayContaining(["end-frame", "audio", "reference-image"]))
        // `video-reference` would derive wan into GVP_EXTEND_PROVIDERS, but the
        // r2v forwarding path is unwired and KIE caps input-video + output at
        // 30s — a bound the segment splitter cannot express.
        expect(entry.features).not.toContain("video-reference")
      })
    })
  }
})

describe("wan-3 provider wiring", () => {
  for (const id of WAN_3_IDS) {
    it(`${id} is registered for BOTH t2v and i2v and is NOT image-required`, () => {
      expect(IMAGE_TO_VIDEO_PROVIDERS).toContain(id)
      expect(TEXT_TO_VIDEO_PROVIDERS).toContain(id)
      expect(VIDEO_PROVIDERS_REQUIRING_IMAGE.has(id)).toBe(false)
    })

    it(`${id} carries the 10/5/5 multimodal reference caps`, () => {
      expect(VIDEO_REF_LIMITS_BY_PROVIDER[id]).toEqual({ images: 10, videos: 5, audio: 5 })
      expect(SEEDANCE_2_R2V_MAX_AUDIO_SEC_BY_PROVIDER[id]).toBe(15)
    })

    it(`${id} audio capability: ambient behind the model's own \`audio\` boolean, default on`, () => {
      const cap = getVideoAudioCapability(id)
      expect(cap.mode).toBe("ambient")
      expect(cap.field).toBe("audio")
      expect(cap.defaultOn).toBe(true)
      expect(cap.affectsCost).toBeUndefined()
    })

    it(`${id} defaults to the adaptive aspect (the KIE default, first in its enum)`, () => {
      expect(defaultVideoAspectRatio(id)).toBe("adaptive")
      expect(NATIVE_ADAPTIVE_ASPECT[id]).toBe("adaptive")
    })

    it(`${id} prompt cap is the documented 20000 chars`, () => {
      expect(getMaxVideoPromptChars(id)).toBe(20000)
    })

    it(`${id} prices per second: one duration tier per allowed second 2-30`, () => {
      expect(DURATION_PRICED_PROVIDERS.has(id)).toBe(true)
      const tiers = VIDEO_DURATION_TIERS[id]
      expect(tiers.map((t) => t.maxSeconds)).toEqual(DURATIONS_2_TO_30)
      expect(RESOLUTION_DURATION_PRICING[id]).toEqual(["480p", "720p", "1080p"])
    })
  }
})

describe("wan-3 family predicate — exact membership, never prefix-matched", () => {
  it("matches exactly the two Wan 3.0 SKUs", () => {
    expect([...WAN_3_PROVIDERS].sort()).toEqual(["wan-3", "wan-3-prime"])
    expect(isWan3Provider("wan-3")).toBe(true)
    expect(isWan3Provider("wan-3-prime")).toBe(true)
  })

  it("does NOT match any Wan 2.x id (the prefix trap)", () => {
    for (const other of ["wan", "wan-i2v", "wan-turbo", "wan-flash", "wan-videoedit", "wan-2.7-i2v", "wan-2.7-t2v"]) {
      expect(isWan3Provider(other), other).toBe(false)
    }
    expect(isWan3Provider(undefined)).toBe(false)
    expect(isWan3Provider("")).toBe(false)
  })

  it("stays OUT of the Seedance 2 and MiniMax H3 family sets", () => {
    for (const id of WAN_3_IDS) {
      expect(isSeedance2Provider(id), id).toBe(false)
      expect(SEEDANCE_2_PROVIDERS.has(id), id).toBe(false)
      expect(isMinimaxH3Provider(id), id).toBe(false)
    }
  })

  it("IS a blessed GVP SKU (derived) but NOT extend-eligible", () => {
    for (const id of WAN_3_IDS) {
      expect([...GVP_SUPPORTED_PROVIDERS], id).toContain(id)
      expect([...GVP_EXTEND_PROVIDERS], id).not.toContain(id)
    }
  })
})

describe("normalizeWan3Resolution — the ONE producer of the uppercase wire form", () => {
  it("uppercases a supported tier, case-insensitively", () => {
    expect(normalizeWan3Resolution("480p")).toBe("480P")
    expect(normalizeWan3Resolution("480P")).toBe("480P")
    expect(normalizeWan3Resolution("720p")).toBe("720P")
    expect(normalizeWan3Resolution("1080P")).toBe("1080P")
    expect(normalizeWan3Resolution(" 1080p ")).toBe("1080P")
  })

  it("collapses undefined / garbage / an off-menu tier to the 720P platform default", () => {
    expect(WAN_3_DEFAULT_RESOLUTION).toBe("720P")
    // 720P, not KIE's own 1080P default: the bare credit identifier prices the
    // 720p tier, so billing can never undercut the render.
    expect(normalizeWan3Resolution(undefined)).toBe("720P")
    expect(normalizeWan3Resolution("")).toBe("720P")
    expect(normalizeWan3Resolution("4k")).toBe("720P")
    expect(normalizeWan3Resolution("2K")).toBe("720P")
  })
})

describe("wan-3 credit identifiers — totality over the whole (duration × resolution) space", () => {
  const build = (provider: string, duration?: number, resolution?: string) =>
    buildVideoCreditModelIdentifier(provider, duration, undefined, "image-to-video", undefined, resolution, undefined)

  for (const id of WAN_3_IDS) {
    it(`${id} emits exactly one composite per (duration, resolution) pair — 87 distinct ids`, () => {
      const emitted = new Set<string>()
      for (const d of DURATIONS_2_TO_30) {
        for (const res of ["480p", "720p", "1080p"]) {
          const identifier = build(id, d, res)
          expect(identifier, `${id} ${d}s ${res}`).toBe(`${id}:${d}s:${res}`)
          emitted.add(identifier)
        }
      }
      expect(emitted.size).toBe(87)
    })

    it(`${id} prices an OMITTED resolution at the declared 720p default, not the cheapest tier`, () => {
      // The tier list is ascending, so a bare resTiers[0] fallback would have
      // reserved 480p against a 720p render — and commit_credits (refund-only)
      // can never collect the shortfall.
      expect(build(id, 5)).toBe(`${id}:5s:720p`)
      expect(build(id, 8)).toBe(`${id}:8s:720p`)
    })

    it(`${id} collapses an UNSUPPORTED resolution to the same 720p default`, () => {
      for (const bogus of ["4k", "2k", "360p", "768P", "not-a-resolution"]) {
        expect(build(id, 5, bogus), bogus).toBe(`${id}:5s:720p`)
      }
    })

    it(`${id} bills the tier it RENDERS for every spelling of the resolution`, () => {
      // The render path is `normalizeWan3Resolution` (case-insensitive, trims),
      // so the billing path must collapse through the SAME normalizer. KIE's own
      // OpenAPI enum is UPPERCASE ("1080P"), which is the natural value for an
      // integrator reading the provider docs and reaches both consumers raw:
      // the route Zod is `z.string().optional()` and neither the credit builder
      // nor the queue payload canonicalises it. A case-sensitive `includes`
      // rendered 1080P while billing the 720p row — a 2x shortfall that
      // commit_credits (refund-only) can never collect.
      for (const spelling of ["1080P", "480P", "720P", " 720p ", "1080p", "480p", "720p", "4K", "garbage"]) {
        const rendered = normalizeWan3Resolution(spelling).toLowerCase()
        expect(build(id, 5, spelling), `${id} 5s "${spelling}"`).toBe(`${id}:5s:${rendered}`)
        expect(build(id, 30, spelling), `${id} 30s "${spelling}"`).toBe(`${id}:30s:${rendered}`)
      }
    })

    it(`${id} snaps an off-menu duration into a seeded tier rather than the bare id`, () => {
      // Below the floor → the first tier; above the ceiling → the last one.
      expect(build(id, 1, "720p")).toBe(`${id}:2s:720p`)
      expect(build(id, 45, "720p")).toBe(`${id}:30s:720p`)
      // An omitted duration renders the KIE default of 5s.
      expect(build(id, undefined, "720p")).toBe(`${id}:5s:720p`)
    })

    it(`${id} never emits the bare id from the generate path`, () => {
      for (const d of [undefined, ...DURATIONS_2_TO_30]) {
        for (const res of [undefined, "480p", "720p", "1080p", "4k"]) {
          expect(build(id, d, res)).not.toBe(id)
        }
      }
    })
  }

  it("every catalog pricing row for the family is an id the builder can actually emit", () => {
    for (const id of WAN_3_IDS) {
      for (const row of MODEL_CATALOG[id].pricing ?? []) {
        // The bare row is the reservation-time default; every other row is a
        // duration×resolution composite the builder must be able to produce.
        if (row.identifier === id) continue
        const m = /^(.+):(\d+)s:(\d+p)$/.exec(row.identifier)
        expect(m, row.identifier).not.toBeNull()
        expect(build(m![1]!, Number(m![2]), m![3])).toBe(row.identifier)
      }
    }
  })
})
