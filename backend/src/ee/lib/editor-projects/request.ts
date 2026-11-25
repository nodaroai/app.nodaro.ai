import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { refuse } from "./errors.js"

/** What the editor-project routes read off a request, checked the same way by every route. */

/** A browser tab's claim id: 8 to 64 of [A-Za-z0-9_-]. */
export const HOLDER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A holder from a JSON body: 400 `invalid_holder` unless it matches `HOLDER_PATTERN`. */
export function holderOf(holder: string): string {
  if (!HOLDER_PATTERN.test(holder)) throw refuse(400, "invalid_holder")
  return holder
}

/** `:id` must be a UUID; anything else is a project that does not exist (404, never a 500). */
export const idParams = z.object({ id: z.string() })

export function projectIdOf(req: FastifyRequest): string {
  const parsed = idParams.safeParse(req.params)
  if (!parsed.success || !UUID_PATTERN.test(parsed.data.id)) throw refuse(404, "not_found")
  return parsed.data.id.toLowerCase()
}

/** The signed-in caller, or a 401 sent (and null). */
export function callerOf(req: FastifyRequest, reply: FastifyReply): string | null {
  if (req.userId) return req.userId
  void reply.status(401).send({ error: "unauthorized" })
  return null
}

/** A 400 for a body or query that does not parse. */
export function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: "validation_error", message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") })
}

/** A version number in a path or a query: digits only, 1 to 2147483647 (the column's range). */
export const versionNumber = z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).refine((n) => n <= 2_147_483_647)

/** A name: trimmed, 1 to 120 characters. */
export const projectName = z.string().trim().min(1).max(120)
