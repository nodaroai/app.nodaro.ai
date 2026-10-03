import { describe, it, expect } from "vitest"
import {
  AUDIO_PRODUCER_TYPES,
  VIDEO_PRODUCER_TYPES,
  DYNAMIC_PRODUCER_TYPES,
} from "../producer-types.js"
import { getOutputType } from "../presentation-utils.js"

/**
 * Producer-set membership is what every downstream node's typed-handle
 * `accepts(sourceType)` predicate consults to decide whether an edge LEAVING
 * a source node may land on its input. A node with audio/video OUTPUT handles
 * that is absent from these sets can't connect its outputs anywhere — the
 * canvas validator hard-rejects every edge (drift bug class, see file header).
 *
 * This guards the recurrence where `voice-changer-pro` (renamed from
 * voice-recast in #3581) shipped with output handles but was never added to
 * the producer sets, so "cannot connect the outputs of voice-changer-pro".
 */
describe("producer-types", () => {
  const ALL_SETS = {
    AUDIO_PRODUCER_TYPES,
    VIDEO_PRODUCER_TYPES,
    DYNAMIC_PRODUCER_TYPES,
  } as const

  // still-to-video (still image + audio → MP4 via local FFmpeg) has a video
  // OUTPUT handle — absent from this set, every downstream video input would
  // hard-reject its edges (the "cannot connect the outputs" bug class).
  it("registers still-to-video as a video producer", () => {
    expect(VIDEO_PRODUCER_TYPES.has("still-to-video")).toBe(true)
  })

  it("registers slideshow as a video producer (still-to-video's N-image companion)", () => {
    expect(VIDEO_PRODUCER_TYPES.has("slideshow")).toBe(true)
  })

  it("registers voice-changer-pro as an audio producer (its default output)", () => {
    expect(AUDIO_PRODUCER_TYPES.has("voice-changer-pro")).toBe(true)
  })

  it("registers voice-changer-pro as a dynamic producer (dual-mode → accepted on BOTH audio and video input handles)", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("voice-changer-pro")).toBe(true)
  })

  // Dubbing joined the dual-mode family with the full-surface upgrade
  // (audio in → dubbed audio; video in / video sourceUrl → dubbed video +
  // audio sidecar). EXPLICIT assertions — the suite does not fail on
  // omission, so without these a refactor could drop dubbing from a set
  // and resurrect the "cannot connect the outputs" bug for it alone.
  it("registers dubbing as an audio producer (its default output)", () => {
    expect(AUDIO_PRODUCER_TYPES.has("dubbing")).toBe(true)
  })

  it("registers dubbing as a dynamic producer (dual-mode → accepted on BOTH audio and video input handles)", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("dubbing")).toBe(true)
  })

  it("keeps dubbing's producer membership identical to voice-changer (same dual-mode contract)", () => {
    for (const [name, set] of Object.entries(ALL_SETS)) {
      expect(
        set.has("dubbing"),
        `dubbing must match voice-changer in ${name}`,
      ).toBe(set.has("voice-changer"))
    }
  })

  // voice-changer-pro is a behavioral twin of voice-changer (identical
  // dual-mode output: audio in → audio out; video in → video out). Their
  // producer-set membership must never drift apart — if voice-changer is
  // later added to/removed from any set, the same must happen for the Pro
  // variant, or its outputs silently stop connecting in exactly one mode.
  it("keeps voice-changer-pro's producer membership identical to its twin voice-changer", () => {
    for (const [name, set] of Object.entries(ALL_SETS)) {
      expect(
        set.has("voice-changer-pro"),
        `voice-changer-pro must match voice-changer in ${name}`,
      ).toBe(set.has("voice-changer"))
    }
  })

  // apply-edl is the FIRST node with BOTH a dynamic media output handle (its
  // `output` setting decides video|audio) AND a fixed `json` handle (the
  // remapped Transcript). The dynamic media half MUST be a DYNAMIC producer so
  // its default handle is accepted on both audio and video inputs; explicit
  // assertion because the suite does not fail on omission.
  it("registers apply-edl as a dynamic producer (video|audio decided at run time)", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("apply-edl")).toBe(true)
  })

  // getOutputType deliberately ignores DYNAMIC_PRODUCER_TYPES and answers
  // "data" for its members, so a published app would render apply-edl's cut as
  // a JSON blob. apply-edl is therefore ALSO in the literal VIDEO_OUTPUT_TYPES
  // (presentation-utils.ts), mirroring voice-changer/dubbing — this pins that
  // the classifier answers "video", not "data".
  it("classifies apply-edl as a video output (literal VIDEO_OUTPUT_TYPES wins over DYNAMIC 'data')", () => {
    expect(getOutputType("apply-edl")).toBe("video")
  })
  // video-overlay renders timed image layers over a video → emits a video URL
  // on `video-out`. Absent here, every downstream video input would reject it.
  it("registers video-overlay as a video producer", () => {
    expect(VIDEO_PRODUCER_TYPES.has("video-overlay")).toBe(true)
  })
})
