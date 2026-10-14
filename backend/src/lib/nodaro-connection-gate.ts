/**
 * The one connection gate: an install that is not connected to nodaro.ai is
 * refused with the same honest 503 every relayed (cloud-exclusive) surface
 * answers. `nodaroConnectionRefusal()` holds the check, the code and the
 * words; `requireNodaroConnection(reply)` is its route form. Moved from
 * routes/nodaro-exclusive.ts so the use-case routes answer identically.
 */
import type { FastifyReply } from "fastify"
import { isNodaroConnected } from "./nodaro-connect.js"
import { NODARO_CONNECTION_REQUIRED_CODE, NODARO_CONNECTION_REQUIRED_MESSAGE } from "./nodaro-connection-messages.js"

/** A refusal a route sends as `{ error: { code, message } }` with `status`. */
export type NodaroConnectionRefusal = { readonly status: 503; readonly code: string; readonly message: string }

/** `null` when connected; otherwise the refusal. A failed read counts as not connected. */
export async function nodaroConnectionRefusal(): Promise<NodaroConnectionRefusal | null> {
  const connected = await isNodaroConnected().catch(() => false)
  if (connected) return null
  return { status: 503, code: NODARO_CONNECTION_REQUIRED_CODE, message: NODARO_CONNECTION_REQUIRED_MESSAGE }
}

/** Structured refusal the frontend renders with a "Connect nodaro.ai" CTA.
 *  503: the capability exists, the install is just not connected to the
 *  thing that serves it. Returns false once the refusal is sent. */
export async function requireNodaroConnection(reply: FastifyReply): Promise<boolean> {
  const refusal = await nodaroConnectionRefusal()
  if (!refusal) return true
  reply.status(refusal.status).send({ error: { code: refusal.code, message: refusal.message } })
  return false
}
