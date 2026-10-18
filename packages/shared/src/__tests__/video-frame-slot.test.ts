import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL,
  videoProviderAppendsFrames,
  videoProviderRefModeFrameSeats,
  videoProviderReferenceSyntax,
} from "../model-constants.js"

/**
 * The frames-after-references convention, as a catalog capability.
 *
 * Every reference-capable video model either appends its frames after the
 * caller's references (one shared image list, the platform convention) or
 * rides them on a channel of their own. A new reference-capable model is
 * appending by default, so it cannot ship frame-first by accident.
 */
const refCapable = Object.values(MODEL_CATALOG).filter(
  (m) => m.kind === "video" && m.features?.includes("reference-image") === true,
)

describe("videoProviderAppendsFrames", () => {
  it("every reference-capable video model appends frames unless its frames have their own channel", () => {
    for (const m of refCapable) {
      const separate = VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL.has(m.id)
      expect(videoProviderAppendsFrames(m.id) || separate, `${m.id} neither appends nor has a frame channel`).toBe(true)
      expect(videoProviderAppendsFrames(m.id) && separate, `${m.id} cannot be both`).toBe(false)
    }
  })

  it("the separate-channel set names only reference-capable video models", () => {
    for (const id of VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL) {
      expect(refCapable.map((m) => m.id), id).toContain(id)
    }
  })

  it("is false for a model with no reference images and for unknown ids", () => {
    expect(videoProviderAppendsFrames("kling")).toBe(false)
    expect(videoProviderAppendsFrames("nope")).toBe(false)
    expect(videoProviderAppendsFrames(undefined)).toBe(false)
  })
})

describe("videoProviderRefModeFrameSeats", () => {
  it("counts the start frame, and the end frame only where the model takes one", () => {
    expect(videoProviderRefModeFrameSeats("seedance-2", { hasStartFrame: true, hasEndFrame: true })).toBe(2)
    expect(videoProviderRefModeFrameSeats("seedance-2", { hasStartFrame: false, hasEndFrame: true })).toBe(1)
    expect(videoProviderRefModeFrameSeats("vidu-q4", { hasStartFrame: true, hasEndFrame: true })).toBe(1)
    expect(videoProviderRefModeFrameSeats("seedance-2", { hasStartFrame: false, hasEndFrame: false })).toBe(0)
  })

  it("is 0 on a model whose frames ride their own channel", () => {
    for (const id of VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL) {
      expect(videoProviderRefModeFrameSeats(id, { hasStartFrame: true, hasEndFrame: true }), id).toBe(0)
    }
  })

  it("never exceeds the frames wired, and agrees with the catalog end-frame feature", () => {
    for (const m of refCapable) {
      if (!videoProviderAppendsFrames(m.id)) continue
      const both = videoProviderRefModeFrameSeats(m.id, { hasStartFrame: true, hasEndFrame: true })
      expect(both, m.id).toBe(m.features?.includes("end-frame") ? 2 : 1)
    }
  })
})

describe("videoProviderReferenceSyntax", () => {
  it("defaults to the platform's @image_N", () => {
    expect(videoProviderReferenceSyntax("seedance-2")).toBe("@image_N")
    expect(videoProviderReferenceSyntax(undefined)).toBe("@image_N")
  })

  it("names the providers' own documented forms", () => {
    expect(videoProviderReferenceSyntax("grok-i2v")).toBe("@image(n)")
    expect(videoProviderReferenceSyntax("happyhorse-ref2v")).toBe("[Image N]")
  })

  it("is declared only on reference-capable video models", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      if (!m.referenceSyntax) continue
      expect(m.kind, m.id).toBe("video")
      expect(m.features, m.id).toContain("reference-image")
    }
  })
})
