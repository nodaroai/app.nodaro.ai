import type { FastifyRequest, FastifyReply } from "fastify"
import { checkIsAdmin } from "../../lib/admin-check.js"

/**
 * Admins only. A refusal RETURNS the reply: an async hook that sends without
 * returning lets Fastify carry on into the handler once another async hook
 * (an onSend) is registered — the handler would then run for a non-admin.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const userId = req.userId
  if (!userId) {
    return reply.status(401).send({
      error: { code: "unauthorized", message: "Authentication required" },
    })
  }
  const isAdmin = await checkIsAdmin(userId)
  if (!isAdmin) {
    return reply.status(403).send({
      error: { code: "forbidden", message: "Admin access required" },
    })
  }
}
