import { describe, it, expect } from "vitest"
import { DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"
import { isValidGenerateImageConnection } from "../generate-image-handles"
import { isValidGenerateVideoConnection } from "../generate-video-handles"
import { ACCEPTS_VIDEO, ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "../ffmpeg-handles"
import { isVisualPickerType } from "../parameter-picker-types"

/**
 * Regression net for the dynamic-producer escape hatch. The class of bug
 * being prevented: a strict typed-handle validator rejects a source whose
 * runtime output can legitimately match (loop iterating per-row, sub-
 * workflow returning a leaf type, adjust-volume in video mode, etc.).
 *
 * Pre-fix the canvas validator's default-true fallback allowed these.
 * After the typed-handle migration tightened dispatch, the only thing
 * keeping them connectable is DYNAMIC_PRODUCER_TYPES inclusion in each
 * sibling validator. Pinning that here so a future refactor can't drop
 * the inclusion silently.
 */

const DYNAMIC = Array.from(DYNAMIC_PRODUCER_TYPES)

describe("DYNAMIC_PRODUCER_TYPES — shared set contents", () => {
  it("contains the documented runtime-typed producers", () => {
    // Pinning the exact set so adding/removing a producer is a deliberate
    // change (forcing the next dev to update both this test AND the
    // sibling validators that depend on it).
    expect(new Set(DYNAMIC_PRODUCER_TYPES)).toEqual(new Set([
      "loop",
      "list",
      "sub-workflow",
      "adjust-volume",
      "reduce",
    ]))
  })

  it("excludes trigger nodes (their outputs are user-shaped JSON, not media)", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("webhook-trigger")).toBe(false)
    expect(DYNAMIC_PRODUCER_TYPES.has("schedule-trigger")).toBe(false)
  })
})

describe("DYNAMIC_PRODUCER_TYPES — ffmpeg handles accept", () => {
  it.each(DYNAMIC)("ACCEPTS_VIDEO(%s) is true", (t) => {
    expect(ACCEPTS_VIDEO(t)).toBe(true)
  })
  it.each(DYNAMIC)("ACCEPTS_AUDIO(%s) is true", (t) => {
    expect(ACCEPTS_AUDIO(t)).toBe(true)
  })
  it.each(DYNAMIC)("ACCEPTS_MEDIA(%s) is true", (t) => {
    expect(ACCEPTS_MEDIA(t)).toBe(true)
  })
})

describe("DYNAMIC_PRODUCER_TYPES — generate-image handles accept", () => {
  it.each(DYNAMIC)("references handle accepts %s", (t) => {
    expect(isValidGenerateImageConnection("references", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("prompt handle accepts %s", (t) => {
    expect(isValidGenerateImageConnection("prompt", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("negative handle accepts %s", (t) => {
    expect(isValidGenerateImageConnection("negative", t, isVisualPickerType)).toBe(true)
  })

  it("assets handle does NOT accept dynamic producers (identity refs only)", () => {
    for (const t of DYNAMIC) {
      expect(isValidGenerateImageConnection("assets", t, isVisualPickerType)).toBe(false)
    }
  })
})

describe("DYNAMIC_PRODUCER_TYPES — generate-video handles accept", () => {
  it.each(DYNAMIC)("startFrame handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("startFrame", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("endFrame handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("endFrame", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("imageReferences handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("imageReferences", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("videoReferences handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("videoReferences", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("audio handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("audio", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("audioReferences handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("audioReferences", t, isVisualPickerType)).toBe(true)
  })
  it.each(DYNAMIC)("prompt handle accepts %s", (t) => {
    expect(isValidGenerateVideoConnection("prompt", t, isVisualPickerType)).toBe(true)
  })

  it("assets handle does NOT accept dynamic producers (identity refs only)", () => {
    for (const t of DYNAMIC) {
      expect(isValidGenerateVideoConnection("assets", t, isVisualPickerType)).toBe(false)
    }
  })
})
