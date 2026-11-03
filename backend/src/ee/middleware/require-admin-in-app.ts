import type { FastifyReply, FastifyRequest } from "fastify"
import { requireAdmin } from "./require-admin.js"

/** 403 body: the account is an administrator, the credential is not the app's session. */
export const IN_APP_ONLY = {
  error: { code: "in_app_only", message: "This answers an administrator signed in to the app only." },
} as const

/**
 * An administrator signed in to the app, and no other credential of theirs.
 *
 * `requireAdmin` authorizes the ACCOUNT, so it lets through every credential
 * that account holds: an API token, an app's OAuth token, a billing key, the
 * internal secret acting for it. A route that shows a person's details
 * decrypted (a complainant's address and phone) or acts on another account's
 * content (a restriction, a lift) answers the browser session only: a leaked
 * or over-scoped token must not read a complaint or restrict a file.
 *
 * A refusal RETURNS the reply, as `requireAdmin` does (see its note on async
 * hooks): a non-administrator still hears "Admin access required" first.
 */
export async function requireAdminInApp(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  await requireAdmin(req, reply)
  if (reply.sent) return reply
  if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
}
