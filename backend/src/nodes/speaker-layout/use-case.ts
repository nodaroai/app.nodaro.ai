// backend/src/nodes/speaker-layout/use-case.ts — Speaker Layout's request body (the factory route
// POST /v1/speaker-layout parses it) and its GET /v1/nodes input schema (decided 2026-10-17): one
// to six recordings, an optional Master audio and Cameras settings, and how the speakers are framed.
//
// Decisions this unit carries:
// - A use-case node: one job that transcribes the whole recording and frames it by speaker with
//   Speaker View — the same length, nothing cut. No plan, so no plan settings.
// - Nodaro-exclusive (unit.json capability "edition:nodaro-exclusive"): Speaker View runs on
//   nodaro.ai; the route itself is core and is never relayed whole.
// - `switchType` and `emphasisStyle` are the values Speaker View draws (decided 2026-10-20): anything
//   else is refused here, as Clip Pack's body refuses it, never swapped for the default.
// - `framingSource` is optional with no default here: an absent one reads Speaker Layout's
//   absent default (`auto`, its spec's `absentFramingSource`) for the caller, in one place.
import { z } from "zod"
import { CLIP_PACK_EMPHASIS_REFUSAL, SPEAKER_VIEW_LAYOUT_SETTINGS, USE_CASE_FRAMING_SOURCES, isClipPackEmphasis } from "@nodaro/render-rules"
import { EDL_TARGET_ASPECTS, SPEAKER_SWITCH_IDS } from "@nodaro/shared/edl"
import { usecaseLaneShape, usecaseMulticamRecordingShape } from "../../lib/use-case/body-shapes.js"
import type { UnitUseCase } from "../kit.js"

export const body = z.object({
  ...usecaseMulticamRecordingShape,
  targetAspect: z.enum(EDL_TARGET_ASPECTS as unknown as [string, ...string[]]).optional(),
  layout: z.enum(SPEAKER_VIEW_LAYOUT_SETTINGS as unknown as [string, ...string[]]).optional(),
  switchType: z.enum(SPEAKER_SWITCH_IDS as unknown as [string, ...string[]]).optional(),
  // A combination of emphasis atoms, so not a flat enum: the builder's own predicate.
  emphasisStyle: z.string().max(40).refine(isClipPackEmphasis, CLIP_PACK_EMPHASIS_REFUSAL).optional(),
  framingSource: z.enum(USE_CASE_FRAMING_SOURCES as unknown as [string, ...string[]]).optional(),
  reviewBeforeRender: z.boolean().optional(),
  ...usecaseLaneShape,
})

export const useCase: UnitUseCase = {
  body,
  inputSchema: {
    fields: [
      { key: "mediaUrls", type: "video-url-array", required: true },
      { key: "masterAudioUrl", type: "audio-url" },
      { key: "cameras", type: "object" },
      { key: "targetAspect", type: "select", options: EDL_TARGET_ASPECTS as unknown as string[] },
      { key: "layout", type: "select", options: SPEAKER_VIEW_LAYOUT_SETTINGS as unknown as string[] },
      { key: "switchType", type: "select", options: SPEAKER_SWITCH_IDS as unknown as string[] },
      { key: "emphasisStyle", type: "string" },
      { key: "framingSource", type: "select", options: USE_CASE_FRAMING_SOURCES as unknown as string[] },
      { key: "reviewBeforeRender", type: "boolean" },
    ],
  },
}
