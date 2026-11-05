import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { IMPORT_SHARE_MAX_DAYS, importDeclarationShare } from "../../lib/unconfirmed-imports.js"

/**
 * Admin → Settings → Content rights: how many imports carried a declaration
 * (migration 597; lib/unconfirmed-imports.ts), the figure an administrator
 * reads before turning `content_rights_required` on. Admin accounts only (any
 * credential of one, like the other admin routes). The rows are counts by
 * declaration, lane, way in and connected app: never a link, a site or an
 * account. `countingSince` is set when counting began inside the window asked
 * for: the figures start there.
 */
const shareQuery = z.object({ days: z.coerce.number().int().min(1).max(IMPORT_SHARE_MAX_DAYS).default(7) })

export async function adminImportShareRoutes(app: FastifyInstance) {
  app.get("/v1/admin/content-rights/import-share", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = shareQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    try {
      const share = await importDeclarationShare(parsed.data.days)
      return { data: share.rows, days: parsed.data.days, countingSince: share.countingSince }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the import share")
    }
  })
}
