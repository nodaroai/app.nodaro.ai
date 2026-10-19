// backend/src/nodes/clip-pack/use-case.ts — Clip Pack's request body (the factory route
// POST /v1/clip-pack parses it) and its GET /v1/nodes input schema: the recording, how many clips
// and how long, the framing, captions and the plan's settings.
//
// Decisions this unit carries (they lived beside the hand-written rows it replaced):
// - A use-case node (decided 2026-10-14): one job that transcribes the recording, plans a pack of
//   clips and renders each one.
// - outputType "video" (unit.json registry.outputType): the clips on `clips` (a list, one per
//   clip; an Each wire runs once per clip) — audio clips for an audio recording, which is why that
//   pip is runtimeTyped — and the plan's clip set (an EDL per clip) on `json`.
import { z } from "zod"
import {
  CLIP_PACK_EMPHASIS_REFUSAL,
  CLIP_PACK_MAX_TARGET_SEC,
  CLIP_PACK_MIN_TARGET_SEC,
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  isClipPackEmphasis,
} from "@nodaro/render-rules"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import { EDIT_PLAN_MAX_CLIP_COUNT, EDIT_PLAN_TIERS, EDL_TARGET_ASPECTS, SPEAKER_SWITCH_IDS } from "@nodaro/shared/edl"
import { usecaseLaneShape, usecasePlanShape, usecaseRecordingShape } from "../../lib/use-case/body-shapes.js"
import type { UnitUseCase } from "../kit.js"

/**
 * Clip Pack: the recording, how many clips and how long, the framing (an
 * aspect, a layout — `stacked` when left out — a switch and an emphasis, on
 * automatic boxes; null = the recording's shape), captions and the plan's
 * settings. An emphasis this version does not draw is refused here, never
 * swapped for the default.
 */
export const body = z.object({
  ...usecaseRecordingShape,
  count: z.number().int().min(1).max(EDIT_PLAN_MAX_CLIP_COUNT).optional(),
  targetDurationSec: z.number().int().min(CLIP_PACK_MIN_TARGET_SEC).max(CLIP_PACK_MAX_TARGET_SEC).optional(),
  framing: z.object({
    aspect: z.enum(EDL_TARGET_ASPECTS as unknown as [string, ...string[]]),
    layout: z.enum(SPEAKER_VIEW_LAYOUT_SETTINGS as unknown as [string, ...string[]]).optional(),
    switchType: z.enum(SPEAKER_SWITCH_IDS as unknown as [string, ...string[]]).optional(),
    emphasisStyle: z.string().max(40).refine(isClipPackEmphasis, CLIP_PACK_EMPHASIS_REFUSAL).optional(),
  }).nullable().optional(),
  captions: z.boolean().optional(),
  captionStyle: z.enum(ALL_CAPTION_STYLES as unknown as [string, ...string[]]).optional(),
  reviewBeforeRender: z.boolean().optional(),
  ...usecasePlanShape,
  ...usecaseLaneShape,
})

export const useCase: UnitUseCase = {
  body,
  inputSchema: {
    fields: [
      { key: "mediaUrls", type: "video-url-array", required: true },
      { key: "count", type: "number" },
      { key: "targetDurationSec", type: "number" },
      { key: "framing", type: "object" },
      { key: "captions", type: "boolean" },
      { key: "captionStyle", type: "select", options: ALL_CAPTION_STYLES as unknown as string[] },
      { key: "reviewBeforeRender", type: "boolean" },
      { key: "planTier", type: "select", options: EDIT_PLAN_TIERS as unknown as string[] },
      { key: "instructions", type: "string" },
      { key: "styleGuide", type: "string" },
    ],
  },
}
