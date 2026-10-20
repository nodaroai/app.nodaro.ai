// backend/src/nodes/tighten-episode/use-case.ts — Tighten Episode's request body (the factory
// route POST /v1/tighten-episode parses it) and its GET /v1/nodes input schema: one to six
// recordings, an optional Master audio and Cameras settings, an optional music bed, and the
// episode's settings.
//
// Decisions this unit carries (they lived beside the hand-written rows it replaced):
// - A use-case node (decided 2026-10-13): one job that builds and runs the transcribe → silence →
//   plan → render chain.
// - Nodaro-exclusive (unit.json capability "edition:nodaro-exclusive", decided 2026-10-13): its
//   plan/render steps run on nodaro.ai; on an unconnected install it is hidden from discovery and
//   badged. The route itself is core — its inner exclusive steps relay one by one, the route is
//   never relayed whole.
// - outputType "video" (unit.json registry.outputType): the episode on the default handle — audio
//   when `output` is audio or the recording has no picture, which is why that pip is
//   runtimeTyped — and the plan (an EDL) on `json`.
import { z } from "zod"
import { SPEAKER_VIEW_LAYOUT_SETTINGS, USE_CASE_FRAMING_SOURCES } from "@nodaro/render-rules"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import { EDIT_PLAN_TIERS, EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { usecaseLaneShape, usecaseMulticamRecordingShape, usecasePlanShape } from "../../lib/use-case/body-shapes.js"
import type { UnitUseCase } from "../kit.js"

export const body = z.object({
  // Up to six recordings, a Master audio and the Cameras settings (decided 2026-10-17).
  ...usecaseMulticamRecordingShape,
  musicUrl: z.optional(safeUrlSchema),
  output: z.enum(["video", "audio"]).optional(),
  /**
   * Frame the episode with Speaker View: an output aspect and a layout, on
   * automatic boxes over the speakers on screen. null/absent = no framing. A
   * layout the aspect does not draw is snapped by the settings resolver, as
   * the render would snap it.
   */
  framing: z.object({
    aspect: z.enum(EDL_TARGET_ASPECTS as unknown as [string, ...string[]]),
    layout: z.enum(SPEAKER_VIEW_LAYOUT_SETTINGS as unknown as [string, ...string[]]),
  }).nullable().optional(),
  /**
   * Where a framed episode's boxes come from (decided 2026-10-17): `static`,
   * the even split by speaker; `tracking`, Speaker Frames follows faces and
   * its tracks feed Speaker View; `auto`, tracking while Speaker Frames is
   * available to the caller, else static (decided 2026-10-20 — the route
   * rewrites it before anything is built). Absent = static (a caller that never sends it keeps its run).
   * Read only with a framing.
   */
  framingSource: z.enum(USE_CASE_FRAMING_SOURCES as unknown as [string, ...string[]]).optional(),
  captions: z.boolean().optional(),
  captionStyle: z.enum(ALL_CAPTION_STYLES as unknown as [string, ...string[]]).optional(),
  reviewBeforeRender: z.boolean().optional(),
  ...usecasePlanShape,
  musicDuckAmount: z.number().min(0).max(100).optional(),
  ...usecaseLaneShape,
})

export const useCase: UnitUseCase = {
  body,
  inputSchema: {
    fields: [
      { key: "mediaUrls", type: "video-url-array", required: true },
      { key: "masterAudioUrl", type: "audio-url" },
      { key: "cameras", type: "object" },
      { key: "musicUrl", type: "audio-url" },
      { key: "output", type: "select", options: ["video", "audio"] },
      { key: "framing", type: "object" },
      { key: "framingSource", type: "select", options: USE_CASE_FRAMING_SOURCES as unknown as string[] },
      { key: "captions", type: "boolean" },
      { key: "captionStyle", type: "select", options: ALL_CAPTION_STYLES as unknown as string[] },
      { key: "reviewBeforeRender", type: "boolean" },
      { key: "planTier", type: "select", options: EDIT_PLAN_TIERS as unknown as string[] },
      { key: "instructions", type: "string" },
      { key: "styleGuide", type: "string" },
      { key: "musicDuckAmount", type: "number" },
    ],
  },
}
