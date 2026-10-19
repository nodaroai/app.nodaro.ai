// backend/src/nodes/episode-trailer/use-case.ts — Trailer's request body (the factory route
// POST /v1/episode-trailer parses it) and its GET /v1/nodes input schema: the recording, an
// optional intro card, the formats to deliver and the plan's settings.
//
// Decisions this unit carries (they lived beside the hand-written rows it replaced):
// - A use-case node (decided 2026-10-14): one job that transcribes the recording, plans a trailer
//   and renders it in every chosen format.
// - outputType "video" (unit.json registry.outputType): the trailers on `media` (a list, one per
//   format; an Each wire runs once per format); the plan (an EDL) on `json`.
import { z } from "zod"
import { TRAILER_FORMATS } from "@nodaro/render-rules"
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { usecaseLaneShape, usecasePlanShape, usecaseRecordingShape } from "../../lib/use-case/body-shapes.js"
import type { UnitUseCase } from "../kit.js"

/**
 * Trailer: the recording, an optional intro card (a video that plays first),
 * the formats to deliver (at least one: an empty list is refused here, before
 * anything is written) and the plan's settings.
 */
export const body = z.object({
  ...usecaseRecordingShape,
  introCardUrl: z.optional(safeUrlSchema),
  formats: z.array(z.enum(TRAILER_FORMATS as unknown as [string, ...string[]])).min(1, "Choose at least one format").max(TRAILER_FORMATS.length).optional(),
  reviewBeforeRender: z.boolean().optional(),
  ...usecasePlanShape,
  ...usecaseLaneShape,
})

export const useCase: UnitUseCase = {
  body,
  inputSchema: {
    fields: [
      { key: "mediaUrls", type: "video-url-array", required: true },
      { key: "introCardUrl", type: "video-url" },
      { key: "formats", type: "string-array", options: TRAILER_FORMATS as unknown as string[] },
      { key: "reviewBeforeRender", type: "boolean" },
      { key: "planTier", type: "select", options: EDIT_PLAN_TIERS as unknown as string[] },
      { key: "instructions", type: "string" },
      { key: "styleGuide", type: "string" },
    ],
  },
}
