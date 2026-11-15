// @test-reads-none mocks the probe; reads no file
/**
 * Every probing node that measures its link before a run answers a link that
 * is not an ordinary media file (the probe guard's refusal with reason
 * `container`: a streaming playlist, a manifest, a concat script) with the one
 * plain refusal, `NOT_A_MEDIA_FILE` — never its generic "could not read", and
 * never a fallback length (Video SFX would otherwise price 8 seconds of it).
 * The probe is stubbed to refuse; each measure is the real one.
 */
import { describe, expect, it, vi } from "vitest"
import { NOT_A_MEDIA_FILE } from "../../providers/video/probe-guard.js"

const notMedia = vi.hoisted(() => () => Object.assign(new Error("probeVideoSource: blocked — a hls link is not an ordinary media file"), { reason: "container" }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: async () => { throw notMedia() },
  probeMediaDuration: async () => { throw notMedia() },
  probeVideoOverlayBaseSource: async () => { throw notMedia() },
  assertSafeProbeSource: async () => undefined,
  ProbeSourceBlockedError: class ProbeSourceBlockedError extends Error {},
  readOwnStoredCopy: async () => { throw new Error("never downloaded") },
}))
vi.mock("../video-utility-probe.js", () => ({
  probeClipLengthSec: async () => { throw notMedia() },
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

import { measureMaskCompositeLength } from "../mask-composite-length.js"
import { measureMaskEraseLength } from "../mask-erase-length.js"
import { measureMaskOutlineLength } from "../mask-outline-length.js"
import { measurePitchTempoDuration } from "../pitch-tempo-duration.js"
import { measureVideoDepthInput } from "../video-depth-input.js"
import { measureVideoFaceMeshLength } from "../video-face-mesh-length.js"
import { measureVideoMaskLength } from "../video-mask-length.js"
import { measureVideoOverlayBase } from "../video-overlay-length.js"
import { measureVideoSfxDuration } from "../video-sfx-duration.js"
import { measureVideoUtilityCharge } from "../video-utility-length.js"
import { planTopazVideoUpscale } from "../topaz-video-plan.js"

const LINK = "https://cdn.example/list.m3u8"
const REFUSED = { ok: false, ...NOT_A_MEDIA_FILE }

describe("a link that is not an ordinary media file gets the one plain refusal on every measuring node", () => {
  it.each([
    ["Mask Composite", () => measureMaskCompositeLength(LINK)],
    ["Mask Erase", () => measureMaskEraseLength(LINK)],
    ["Mask Outline", () => measureMaskOutlineLength(LINK)],
    ["Pitch & Tempo", () => measurePitchTempoDuration(LINK)],
    ["Video Depth", () => measureVideoDepthInput("video-depth-anything", LINK)],
    ["Video Face Mesh", () => measureVideoFaceMeshLength(LINK)],
    ["Video Mask", () => measureVideoMaskLength(LINK)],
    ["Video Overlay", () => measureVideoOverlayBase({ videoUrl: LINK, layers: [] } as unknown as Parameters<typeof measureVideoOverlayBase>[0])],
    ["Video SFX (no 8-second fallback for it)", () => measureVideoSfxDuration(LINK)],
    ["Trim Video", () => measureVideoUtilityCharge("trim-video", { videoUrl: LINK, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 })],
  ])("%s", async (_node, measure) => {
    await expect(measure()).resolves.toEqual(REFUSED)
  })

  it("Combine Videos names the clip", async () => {
    await expect(measureVideoUtilityCharge("combine-videos", { videoUrls: [LINK, LINK] })).resolves.toEqual({
      ok: false,
      code: NOT_A_MEDIA_FILE.code,
      message: `Clip 1 of 2: ${NOT_A_MEDIA_FILE.message}`,
    })
  })

  it("Topaz Video Upscale", async () => {
    await expect(planTopazVideoUpscale(LINK, {})).rejects.toMatchObject({ code: NOT_A_MEDIA_FILE.code, message: NOT_A_MEDIA_FILE.message })
  })
})
