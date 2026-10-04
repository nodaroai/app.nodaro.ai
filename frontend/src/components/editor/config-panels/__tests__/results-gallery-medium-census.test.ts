/**
 * Census: every node type with a config-panel results gallery shows its results
 * as the medium it produces.
 *
 * The gallery used to type a node's results from two hand-kept lists, and about
 * 25 video and audio producers were in neither, so they fell through to "image":
 * an MP3 drawn as a broken image tile, offered as the workflow thumbnail, saved
 * to the Library as an image, and a pick that wrote a stray generatedImageUrl.
 * The medium now comes from @nodaro/shared's producer sets (the single source of
 * truth both canvas validators and the backend use). This census walks the real
 * RESULT_PRODUCING_TYPES, so a new gallery type the gallery cannot type fails
 * the build instead of falling through.
 */
import { describe, it, expect } from "vitest"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { RESULT_PRODUCING_TYPES } from "../../config-panel-node-sets"
import {
  IMAGE_RESULT_TYPES,
  NODE_DATA_MEDIUM,
  NO_MEDIUM_RESULT_TYPES,
  resultsGalleryDeclaresMedium,
  resultsGalleryMediaType,
} from "../results-gallery-media"

const galleryTypes = [...RESULT_PRODUCING_TYPES]
const fixedVideo = galleryTypes.filter((t) => VIDEO_PRODUCER_TYPES.has(t) && !DYNAMIC_PRODUCER_TYPES.has(t))
const fixedAudio = galleryTypes.filter((t) => AUDIO_PRODUCER_TYPES.has(t) && !DYNAMIC_PRODUCER_TYPES.has(t))

describe("results gallery medium census", () => {
  it("every video producer with a gallery is shown as video", () => {
    expect(fixedVideo.length).toBeGreaterThan(20)
    expect(fixedVideo.filter((t) => resultsGalleryMediaType(t, {}) !== "video")).toEqual([])
  })

  it("every audio producer with a gallery is shown as audio", () => {
    expect(fixedAudio.length).toBeGreaterThan(15)
    expect(fixedAudio.filter((t) => resultsGalleryMediaType(t, {}) !== "audio")).toEqual([])
  })

  it("every node type with a gallery declares how its results are typed — a new one cannot fall through to image", () => {
    expect(galleryTypes.filter((t) => !resultsGalleryDeclaresMedium(t))).toEqual([])
  })

  it("a dynamic producer whose medium is a setting is typed from its data, the way its canvas picker reads it", () => {
    expect(resultsGalleryMediaType("apply-edl", { output: "audio" })).toBe("audio")
    expect(resultsGalleryMediaType("apply-edl", {})).toBe("video")
    for (const t of ["voice-changer", "voice-changer-pro", "dubbing"]) {
      expect(resultsGalleryMediaType(t, { generatedVideoUrl: "https://m/v.mp4" })).toBe("video")
      expect(resultsGalleryMediaType(t, {})).toBe("audio")
    }
    expect(resultsGalleryMediaType("adjust-volume", { lastInputType: "video" })).toBe("video")
    expect(resultsGalleryMediaType("adjust-volume", {})).toBe("audio")
    expect([...NODE_DATA_MEDIUM.keys()].filter((t) => !DYNAMIC_PRODUCER_TYPES.has(t))).toEqual([])
  })

  it("the hand-kept lists never contradict the shared producer sets", () => {
    const shared = (t: string) => VIDEO_PRODUCER_TYPES.has(t) || AUDIO_PRODUCER_TYPES.has(t) || DYNAMIC_PRODUCER_TYPES.has(t)
    expect([...IMAGE_RESULT_TYPES].filter(shared)).toEqual([])
    expect([...NO_MEDIUM_RESULT_TYPES].filter(shared)).toEqual([])
    expect([...IMAGE_RESULT_TYPES].filter((t) => NO_MEDIUM_RESULT_TYPES.has(t))).toEqual([])
  })
})
