/**
 * Video Overlay's handle rules (the video-sfx-handles.test.ts twin): the base
 * takes a video, each of the twelve layer handles an image — dynamic sources
 * (list / sub-workflow …) on both — and the reserved layerPlan id nothing.
 */
import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_HANDLE_IDS, VIDEO_OVERLAY_OUTPUT_ASPECTS } from "@nodaro/shared"
import { OVERLAY_HANDLE_IDS, OVERLAY_MAX_LAYERS } from "@/types/nodes"
import { COMPOSITION_RATIOS } from "@/components/editor/config-panels/model-options"
import { isValidVideoOverlayConnection } from "../image-producer-handles"

// The spec and the canvas UX say Video Overlay REUSES Image Overlay's handle ids
// and DERIVES its aspects from COMPOSITION_RATIOS. The backend needs both lists
// too, so they live in @nodaro/shared as well — and these two lines are the
// guard that the copies can never drift (the layout helpers read the frontend
// ids, the registries and the engines read the shared ones; the panel looks
// the aspect labels up in COMPOSITION_RATIOS by value).
describe("Video Overlay's shared lists equal the frontend lists they copy", () => {
  it("VIDEO_OVERLAY_HANDLE_IDS === OVERLAY_HANDLE_IDS (and the 12-handle cap)", () => {
    expect([...VIDEO_OVERLAY_HANDLE_IDS]).toEqual([...OVERLAY_HANDLE_IDS])
    expect(VIDEO_OVERLAY_HANDLE_IDS.length).toBe(OVERLAY_MAX_LAYERS)
  })
  it("VIDEO_OVERLAY_OUTPUT_ASPECTS === COMPOSITION_RATIOS' values, in order", () => {
    expect(COMPOSITION_RATIOS.map((r) => r.value)).toEqual([...VIDEO_OVERLAY_OUTPUT_ASPECTS])
  })
})

describe("isValidVideoOverlayConnection", () => {
  it("the base handle accepts video producers and dynamic sources", () => {
    expect(isValidVideoOverlayConnection("video", "generate-video")).toBe(true)
    expect(isValidVideoOverlayConnection("video", "upload-video")).toBe(true)
    expect(isValidVideoOverlayConnection("video", "combine-videos")).toBe(true)
    expect(isValidVideoOverlayConnection("video", "list")).toBe(true)
  })
  it("the base handle rejects images and text", () => {
    expect(isValidVideoOverlayConnection("video", "generate-image")).toBe(false)
    expect(isValidVideoOverlayConnection("video", "text-prompt")).toBe(false)
  })
  it("every layer handle accepts image producers (an Image Overlay composite included) and rejects video", () => {
    for (const h of VIDEO_OVERLAY_HANDLE_IDS) {
      expect(isValidVideoOverlayConnection(h, "generate-image")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "upload-image")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "image-overlay")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "generate-video")).toBe(false)
    }
  })
  it("layerPlan and unknown handles connect nothing", () => {
    expect(isValidVideoOverlayConnection("layerPlan", "text-prompt")).toBe(false)
    expect(isValidVideoOverlayConnection("overlay13", "generate-image")).toBe(false)
    expect(isValidVideoOverlayConnection("in", "generate-video")).toBe(false)
  })
})
