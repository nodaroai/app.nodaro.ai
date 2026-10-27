/**
 * A full-depth trend's stored scene descriptions (decided 2026-10-28).
 * Registered by `registerTrendFaceMaskRoutes` (admin-trends-face-mask.ts), so
 * it shares the trend admin door; admin-only.
 *
 *   PUT /v1/admin/trends/:id/face-mask/scene-description  { which: "full" | "preview", text, revision }
 *
 * Writes the draft's `faceMask.sceneDescription` (`which: "full"`, the whole
 * clip) or `faceMask.previewSceneDescription` (`"preview"`, the 4 s window):
 * the texts the make job wrote from the original clip, which each run
 * rewrites for its cast (scene-description.ts). Guarded on the draft's
 * revision like every draft write, and audit-logged
 * (`edit_trend_scene_description`). The face mask's settings and settings
 * key are untouched, so editing never puts the mask out of date. 409
 * `no_full_depth_mask` when the draft has no approved full-depth clip.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { faceMaskingSourceOf } from "../../lib/cast-swap-face-masking.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments, type EngineEnvironment } from "../lib/engine-environments.js"
import { DraftConflictError } from "../lib/trends/store.js"
import { SCENE_DESCRIPTION_MAX, trendVersionDataSchema } from "../lib/trends/schemas.js"
import { faceMaskState } from "../lib/trends/face-mask.js"
import { SCENE_DESCRIPTION_FIELD } from "../lib/trends/scene-description.js"
import { unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendFaceMask, TrendVersionData } from "../lib/trends/types.js"
import { audit } from "./admin-trends-lifecycle.js"
import { withVariantsState } from "./admin-trends-face-mask-variants.js"
import type { TrendFaceMaskDeps } from "./admin-trends-face-mask.js"

const sceneDescriptionBody = z.strictObject({
  which: z.enum(["full", "preview"]),
  text: z.string().trim().min(1, "Write the scene description, or make the depth clip again.").max(SCENE_DESCRIPTION_MAX),
  revision: z.string().min(1).max(100),
})

/** Every recorded environment, or null (logged) when they cannot be read: the recipes are then left unchecked. */
async function environmentsOrNull(req: FastifyRequest): Promise<EngineEnvironment[] | null> {
  try {
    return await listEngineEnvironments()
  } catch (e) {
    req.log.warn({ err: e }, "admin-trends: could not read the engine environments; face mask recipes unchecked")
    return null
  }
}

export function registerTrendSceneDescriptionRoutes(app: FastifyInstance, deps: TrendFaceMaskDeps): void {
  app.put("/v1/admin/trends/:id/face-mask/scene-description", { preHandler: requireAdmin }, async (req, reply) => {
    const body = sceneDescriptionBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      if (!draft.faceMask || faceMaskingSourceOf(draft.faceMasking) !== "full-depth") {
        return reply.status(409).send({
          error: { code: "no_full_depth_mask", message: "This trend has no approved full-depth clip: make and approve it first." },
        })
      }
      const field = SCENE_DESCRIPTION_FIELD[body.data.which]
      // The text only: the clip, its settings key, its recipes and the preview start the preview's
      // text was made for (`previewSceneDescriptionStart`) stay as approved.
      const faceMask: TrendFaceMask = { ...draft.faceMask, [field]: body.data.text }
      const next: TrendVersionData = { ...draft, faceMask }
      const valid = trendVersionDataSchema.safeParse(next)
      if (!valid.success) return deps.badRequest(reply, valid.error)
      const saved = await deps.saveValidDraft(reply, trend.id, valid.data, revision)
      if (!saved) return reply
      await audit(req, "edit_trend_scene_description", "trend", trend.id, {
        slug: trend.slug,
        jobId: faceMask.jobId,
        which: body.data.which,
        chars: body.data.text.length,
      })
      const environments = await environmentsOrNull(req)
      return { data: { ...saved, faceMask, faceMaskState: withVariantsState(valid.data, faceMaskState(valid.data, environments, TREND_PUBLISH_ENVIRONMENTS)) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to save the scene description")
    }
  })
}
