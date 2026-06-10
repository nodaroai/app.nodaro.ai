import { describe, expect, it } from "vitest"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  VIDEO_MODE_ALIASES,
  VIDEO_GEN_COLLAPSED_T2V_IDS,
  VIDEO_PROVIDERS_REQUIRING_IMAGE,
  resolveVideoProviderForMode,
} from "../model-constants.js"

const I2V = "image-to-video"
const T2V = "text-to-video"

describe("resolveVideoProviderForMode", () => {
  it("maps the i2v id to itself in i2v mode and to the t2v id in t2v mode (grok)", () => {
    expect(resolveVideoProviderForMode("grok-i2v", I2V)).toBe("grok-i2v")
    expect(resolveVideoProviderForMode("grok-i2v", T2V)).toBe("grok")
  })

  it("maps the t2v id to the i2v id in i2v mode (fixes the t2v-id-plus-image footgun)", () => {
    // Picking the t2v 'grok' and connecting an image used to send 'grok' to the
    // i2v path where KIE_VIDEO_MODELS['grok'] is undefined → crash. Now it
    // resolves to the real i2v id.
    expect(resolveVideoProviderForMode("grok", I2V)).toBe("grok-i2v")
    expect(resolveVideoProviderForMode("grok", T2V)).toBe("grok")
  })

  it("maps Wan 2.6 ids by mode", () => {
    expect(resolveVideoProviderForMode("wan-i2v", I2V)).toBe("wan-i2v")
    expect(resolveVideoProviderForMode("wan-i2v", T2V)).toBe("wan")
    expect(resolveVideoProviderForMode("wan", I2V)).toBe("wan-i2v")
    expect(resolveVideoProviderForMode("wan", T2V)).toBe("wan")
  })

  it("maps Wan 2.7 ids by mode", () => {
    expect(resolveVideoProviderForMode("wan-2.7-i2v", I2V)).toBe("wan-2.7-i2v")
    expect(resolveVideoProviderForMode("wan-2.7-i2v", T2V)).toBe("wan-2.7-t2v")
    expect(resolveVideoProviderForMode("wan-2.7-t2v", I2V)).toBe("wan-2.7-i2v")
    expect(resolveVideoProviderForMode("wan-2.7-t2v", T2V)).toBe("wan-2.7-t2v")
  })

  it("maps HappyHorse ids by mode", () => {
    expect(resolveVideoProviderForMode("happyhorse-i2v", I2V)).toBe("happyhorse-i2v")
    expect(resolveVideoProviderForMode("happyhorse-i2v", T2V)).toBe("happyhorse")
    expect(resolveVideoProviderForMode("happyhorse", I2V)).toBe("happyhorse-i2v")
    expect(resolveVideoProviderForMode("happyhorse", T2V)).toBe("happyhorse")
  })

  it("passes non-aliased providers through unchanged in both modes", () => {
    for (const p of ["kling", "seedance", "veo3", "minimax", "ltx-2.3-pro"]) {
      expect(resolveVideoProviderForMode(p, I2V)).toBe(p)
      expect(resolveVideoProviderForMode(p, T2V)).toBe(p)
    }
  })

  it("passes single-id i2v-only models (grok-imagine-video-1.5) through unchanged", () => {
    // It is its own id in both arrays — never aliased, so no remap.
    expect(resolveVideoProviderForMode("grok-imagine-video-1.5", I2V)).toBe("grok-imagine-video-1.5")
    expect(resolveVideoProviderForMode("grok-imagine-video-1.5", T2V)).toBe("grok-imagine-video-1.5")
  })
})

describe("VIDEO_MODE_ALIASES registry honesty", () => {
  it("every group's i2v id is a real image-to-video provider", () => {
    for (const g of VIDEO_MODE_ALIASES) {
      expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(g.i2v)
    }
  })

  it("every group's t2v id is a real text-to-video provider", () => {
    for (const g of VIDEO_MODE_ALIASES) {
      expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(g.t2v)
    }
  })

  it("every group's base id is one of its own mode ids", () => {
    for (const g of VIDEO_MODE_ALIASES) {
      expect([g.i2v, g.t2v]).toContain(g.base)
    }
  })
})

describe("VIDEO_GEN_COLLAPSED_T2V_IDS (picker collapse set)", () => {
  it("contains exactly the t2v twins whose i2v sibling is the picker base", () => {
    expect(VIDEO_GEN_COLLAPSED_T2V_IDS).toEqual(new Set(["grok", "wan", "wan-2.7-t2v", "happyhorse"]))
  })

  it("every collapsed id is a t2v provider that is NOT also an i2v provider (safe to hide)", () => {
    for (const id of VIDEO_GEN_COLLAPSED_T2V_IDS) {
      expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).not.toContain(id)
    }
  })
})

// ─── Unified-node dispatch totality ─────────────────────────────────────────
// The unified Generate Video node can route ANY of its providers down EITHER
// mode path: t2v when no image is wired, i2v when one is. After the alias
// remap, the resolved id must therefore pass the target route's Zod enum in
// BOTH directions. A provider in only one list (and not aliased) reaches the
// other route as a raw Zod enum 400 — exactly the kling-3-omni /
// "received 'kling-3-omni'" production error. i2v-only providers satisfy the
// t2v direction by being listed in TEXT_TO_VIDEO_PROVIDERS and gated by
// VIDEO_PROVIDERS_REQUIRING_IMAGE (clean "image required" 400 at the route).
describe("unified generate-video dispatch totality", () => {
  it("every VIDEO_GEN_PROVIDERS member resolves to a valid t2v route provider", () => {
    const t2v = new Set<string>(TEXT_TO_VIDEO_PROVIDERS)
    const broken = VIDEO_GEN_PROVIDERS.filter(
      (p) => !t2v.has(resolveVideoProviderForMode(p, T2V)),
    )
    expect(
      broken,
      `These unified-picker providers crash /v1/text-to-video with a Zod enum error when run without an image — add them to TEXT_TO_VIDEO_PROVIDERS (i2v-only models get the friendly 400 via VIDEO_PROVIDERS_REQUIRING_IMAGE) or alias them to a t2v twin: ${broken.join(", ")}`,
    ).toEqual([])
  })

  it("every VIDEO_GEN_PROVIDERS member resolves to a valid i2v route provider", () => {
    const i2v = new Set<string>(IMAGE_TO_VIDEO_PROVIDERS)
    const broken = VIDEO_GEN_PROVIDERS.filter(
      (p) => !i2v.has(resolveVideoProviderForMode(p, I2V)),
    )
    expect(
      broken,
      `These unified-picker providers fail the /v1/generate-video path when an image IS wired — add them to IMAGE_TO_VIDEO_PROVIDERS or alias them to an i2v twin: ${broken.join(", ")}`,
    ).toEqual([])
  })
})

describe("VIDEO_PROVIDERS_REQUIRING_IMAGE (derived from MODEL_CATALOG modes)", () => {
  it("contains exactly the unaliased i2v-only unified-picker providers", () => {
    expect(new Set(VIDEO_PROVIDERS_REQUIRING_IMAGE)).toEqual(
      new Set([
        "grok-imagine-video-1.5",
        "kling-3-omni",
        "kling-master",
        "hailuo-2.3",
        "hailuo-2.3-pro",
        "bytedance-pro-fast",
        "happyhorse-ref2v",
      ]),
    )
  })

  it("never contains a provider with a real t2v path (would wrongly block it)", () => {
    for (const p of VIDEO_PROVIDERS_REQUIRING_IMAGE) {
      expect(resolveVideoProviderForMode(p, T2V), `${p} is aliased to a t2v twin — it must not be image-gated`).toBe(p)
    }
  })
})
