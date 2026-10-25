/** The replies and the read gate `/v1/sessions` and its item routes share. */
import type { FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { requireScope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"

export const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

export function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

export function notFound(reply: FastifyReply, message = "Session not found") {
  return reply.status(404).send({ error: { code: "not_found", message } })
}

export function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

export function badCursor(reply: FastifyReply) {
  return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })
}

export function notInTrash(reply: FastifyReply) {
  return reply.status(409).send({ error: { code: "not_in_trash", message: "Remove the item from the session first." } })
}

/** The signed-in caller allowed to READ, or null after replying. */
export function reader(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    unauthorized(reply)
    return null
  }
  if (req.appAuthorization) {
    const err = requireScope(req.appAuthorization.scopes, "jobs:read")
    if (err) {
      reply.status(err.statusCode).send(err.body)
      return null
    }
  }
  return req.userId
}
