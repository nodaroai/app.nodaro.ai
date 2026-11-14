import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { replicaOf } from "@nodaro/shared/model-catalog"
import { signReplicaConsent } from "../lib/voice-clone-consent.js"
import { deniedCapabilityForUser } from "../lib/availability-viewer.js"
import { deniedNodeRejectionMessage } from "../lib/surface-deny.js"
import { formatZodError } from "../lib/zod-error.js"
import { requireAppWriteScope } from "../lib/scope-prehandler.js"

const body = z.object({ sourceAudioUrl: z.string().max(2048), consentAudioUrl: z.string().max(2048) })

/**
 * POST /v1/voice-clone/consent — the editor's consent box for a one-off voice
 * clone (decided 2026-11-13). Ticking it asks the server for a record of THIS
 * user's consent to clone the voice in these two recordings
 * (`lib/voice-clone-consent.ts`); the node keeps the record, and a workflow
 * run accepts it only from the person it was issued to. Nothing is fetched,
 * stored or charged. Refused where the deployment withholds one-off clones.
 */
export async function voiceCloneConsentRoutes(app: FastifyInstance) {
  // An OAuth app acts here in the account's name (a consent in it): a :write or :execute scope, never a read-only grant.
  app.post("/v1/voice-clone/consent", { preHandler: requireAppWriteScope() }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const parsed = body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const replica = replicaOf(parsed.data)
    if (!replica) {
      return reply.status(400).send({ error: { code: "validation_error", message: "sourceAudioUrl and consentAudioUrl must each be an https link to a WAV recording" } })
    }
    const denied = await deniedCapabilityForUser("text-to-speech", { replica }, userId)
    if (denied) return reply.status(403).send({ error: { code: "node_not_available", message: deniedNodeRejectionMessage([denied]) } })
    return signReplicaConsent(userId, replica)
  })
}
