import { describe, expect, it } from "vitest"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_MODE_ALIASES,
  VIDEO_GEN_COLLAPSED_T2V_IDS,
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
    expect(VIDEO_GEN_COLLAPSED_T2V_IDS).toEqual(new Set(["grok", "wan", "wan-2.7-t2v"]))
  })

  it("every collapsed id is a t2v provider that is NOT also an i2v provider (safe to hide)", () => {
    for (const id of VIDEO_GEN_COLLAPSED_T2V_IDS) {
      expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).not.toContain(id)
    }
  })
})
