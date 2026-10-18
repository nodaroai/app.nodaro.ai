// backend/src/nodes/episode-chapters/use-case.ts — Chapters' request body (the factory route
// POST /v1/episode-chapters parses it) and its GET /v1/nodes input schema: the recording and the
// plan's settings — nothing renders.
import { z } from "zod"
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import { usecaseLaneShape, usecasePlanShape, usecaseRecordingShape } from "../../lib/use-case/body-shapes.js"
import type { UnitUseCase } from "../kit.js"

export const body = z.object({ ...usecaseRecordingShape, ...usecasePlanShape, ...usecaseLaneShape })

export const useCase: UnitUseCase = {
  body,
  inputSchema: {
    fields: [
      { key: "mediaUrls", type: "video-url-array", required: true },
      { key: "planTier", type: "select", options: EDIT_PLAN_TIERS as unknown as string[] },
      { key: "instructions", type: "string" },
      { key: "styleGuide", type: "string" },
    ],
  },
}
