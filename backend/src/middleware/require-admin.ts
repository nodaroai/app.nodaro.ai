import type { FastifyRequest, FastifyReply } from "fastify"
import { checkIsAdmin } from "../lib/admin-check.js"

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = req.userId
  if (!userId) {
    reply.status(401).send({
      error: { code: "unauthorized", message: "Authentication required" },
    })
    return
  }
  const isAdmin = await checkIsAdmin(userId)
  if (!isAdmin) {
    reply.status(403).send({
      error: { code: "forbidden", message: "Admin access required" },
    })
    return
  }
}
