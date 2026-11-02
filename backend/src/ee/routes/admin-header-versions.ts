import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { headerVersions, type HeaderVersionsService } from "../lib/header-versions/header-versions.js"

/**
 * Header versions: which version of the shared header every product's live
 * and test site serves, beside the newest release. Read-only (GitHub with a
 * read-only token, and each site's own public file); no money moves, so the
 * plain admin gate.
 */

const reportQuery = z.object({
  fresh: z.literal("1").optional(),
})

/** The page asks once a minute and the answer is shared; this only bounds a runaway client. */
const REPORT_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

export async function adminHeaderVersionsRoutes(app: FastifyInstance, opts: { service?: HeaderVersionsService } = {}): Promise<void> {
  const service = () => opts.service ?? headerVersions()

  app.get("/v1/admin/header-versions", { preHandler: requireAdmin, config: REPORT_LIMIT }, async (req, reply) => {
    const parsed = reportQuery.safeParse(req.query)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return reply.status(400).send({ error: { code: "validation_error", message: issue ? `${issue.path.join(".") || "query"}: ${issue.message}` : "invalid request" } })
    }
    return service().report({ fresh: parsed.data.fresh === "1" })
  })
}
