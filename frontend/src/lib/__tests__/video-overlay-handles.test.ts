// @test-watches frontend/src/nodes/**
/**
 * Video Overlay's handle rules (the video-sfx-handles.test.ts twin): the base
 * takes a video, each of the twelve layer handles an image or a video — dynamic
 * sources (list / sub-workflow …) on both — and the layerPlan pip a JSON source.
 */
import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_HANDLE_IDS, VIDEO_OVERLAY_OUTPUT_ASPECTS, videoOverlayWiredLayerKind } from "@nodaro/shared/video"
import { outputPipSourceType, resolveEffectiveSourceType } from "@nodaro/shared/entities"
import { OVERLAY_HANDLE_IDS, OVERLAY_MAX_LAYERS } from "@/types/nodes"
import { COMPOSITION_RATIOS } from "@/components/editor/config-panels/model-options"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
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
  it("every layer handle accepts image producers (an Image Overlay composite included), video producers and dynamic sources", () => {
    for (const h of VIDEO_OVERLAY_HANDLE_IDS) {
      expect(isValidVideoOverlayConnection(h, "generate-image")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "upload-image")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "image-overlay")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "generate-video")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "upload-video")).toBe(true)
      expect(isValidVideoOverlayConnection(h, "list")).toBe(true)
    }
    expect(isValidVideoOverlayConnection("overlay3", "generate-video")).toBe(true)
  })
  it("a layer handle refuses an audio-only source and text", () => {
    for (const h of VIDEO_OVERLAY_HANDLE_IDS) {
      expect(isValidVideoOverlayConnection(h, "upload-audio")).toBe(false)
      expect(isValidVideoOverlayConnection(h, "text-to-speech")).toBe(false)
      expect(isValidVideoOverlayConnection(h, "text-prompt")).toBe(false)
    }
  })
  it("the layerPlan handle accepts JSON producers (and lists), never images, video or text", () => {
    expect(isValidVideoOverlayConnection("layerPlan", "extract-field")).toBe(true)
    expect(isValidVideoOverlayConnection("layerPlan", "list")).toBe(true)
    expect(isValidVideoOverlayConnection("layerPlan", "generate-image")).toBe(false)
    expect(isValidVideoOverlayConnection("layerPlan", "generate-video")).toBe(false)
    expect(isValidVideoOverlayConnection("layerPlan", "text-prompt")).toBe(false)
  })
  it("unknown handles connect nothing", () => {
    expect(isValidVideoOverlayConnection("overlay13", "generate-image")).toBe(false)
    expect(isValidVideoOverlayConnection("in", "generate-video")).toBe(false)
  })
})

/**
 * Every image or video pip the editor draws (`HANDLE_OUTPUT_TYPES`, pinned to
 * the JSX by handle-color-guard) that a layer handle accepts must be read as
 * its own medium by the run's wired-kind rule even when its file has no
 * extension (a signed or extension-less URL), judged as both input resolvers
 * route it: the source type its pip behaves as (`outputPipSourceType`) and the
 * pip. A pip of a node that draws both media (a dynamic producer) needs its row
 * in the rule's pip table, or its extension-less video reads as an image.
 */
describe("a layer handle reads every image or video pip as its own medium", () => {
  const EXTENSIONLESS = "https://cdn.example.com/files/7f3a9c"
  const pips = Object.entries(HANDLE_OUTPUT_TYPES).flatMap(([type, outputs]) =>
    Object.entries(outputs ?? {}).flatMap(([handle, medium]) => (medium === "image" || medium === "video" ? [{ type, handle, medium }] : [])),
  )
  const wirable = pips.filter((p) => isValidVideoOverlayConnection("overlay", resolveEffectiveSourceType(p.type, p.handle)))

  it("covers pips of both media", () => {
    expect(wirable.some((p) => p.medium === "image")).toBe(true)
    expect(wirable.some((p) => p.medium === "video")).toBe(true)
  })
  it.each(pips.map((p) => [`${p.type}:${p.handle}`, p] as const))("%s", (_name, p) => {
    if (!wirable.includes(p)) return
    expect(videoOverlayWiredLayerKind({ type: outputPipSourceType(p.type, p.handle), handle: p.handle }, EXTENSIONLESS)).toBe(p.medium)
  })
})
