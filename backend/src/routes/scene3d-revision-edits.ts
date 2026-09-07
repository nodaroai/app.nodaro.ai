import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { scene3DV2EditOperationsSchema } from "@nodaro/shared"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { editRetainedScene3D, Scene3DRetainedEditError } from "../services/scene3d/scene3d-retained-edit.js"
import { isScene3DArtifactError } from "../services/scene3d-artifacts/types.js"
import type { Scene3DObjectStore } from "../services/scene3d-artifacts/object-store.js"

const paramsSchema = z.object({ revisionId: z.uuid() })
const bodySchema = z.object({
  newRevisionId: z.uuid(), expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  operations: scene3DV2EditOperationsSchema,
  lockedObjectIds: z.array(z.string().min(1).max(64)).max(100).optional(),
}).strict()

/** Arithmetic edits have no generation charge; persisted bytes retain their original pins. */
export async function scene3DRevisionEditRoutes(app: FastifyInstance, options: { store?: Scene3DObjectStore | null } = {}) {
  app.post("/v1/3d-scene/revisions/:revisionId/edits", {
    bodyLimit: 128 * 1024,
    preHandler: [requireAppScope("workflows:write"), rateLimiter({ max: 120, windowMs: 60_000, keyPrefix: "scene3d-edits", failClosed: true })],
  }, async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const params = paramsSchema.safeParse(req.params)
    const body = bodySchema.safeParse(req.body)
    if (!params.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(params.error) } })
    if (!body.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
    try {
      return await editRetainedScene3D(req.userId, { ...body.data, revisionId: params.data.revisionId }, options.store ?? null)
    } catch (error) {
      if (error instanceof Scene3DRetainedEditError) return reply.status(error.status).send({ error: { code: error.code, message: error.message } })
      if (isScene3DArtifactError(error) && error.code === "SCENE_REVISION_CONFLICT") {
        return reply.status(409).send({ error: { code: "stale_revision", message: "This revision identifier already contains another edit" } })
      }
      return sendInternalError(reply, req, error, "Failed to save the scene edit")
    }
  })
}
