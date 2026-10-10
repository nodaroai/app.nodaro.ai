import type { FastifyInstance } from "fastify"
import { speakerFramesRelaySupport, type SpeakerFramesRelayAnswer } from "../lib/private-plugins/speaker-frames-relay-support.js"

/**
 * GET /v1/speaker-frames/capabilities — whether this server runs a Speaker
 * Frames job RELAYED from a connected self-host (P3.6, decided 2026-10-09).
 *
 * On nodaro.ai the answer is the loaded plugin's declaration
 * (`supports().speakerFramesRelayedProxies`: its route accepts the self-host's
 * detection proxies and the relayed marker). A connected self-host asks nodaro.ai's copy
 * of this route before it relays, and refuses with "not available on a
 * connected install yet" until the answer is yes. ONE source of truth:
 * `speakerFramesRelaySupport()`.
 *
 * Registered on every edition, read at REQUEST time (`app.ts` registers core
 * routes before it loads the plugins).
 */
export async function speakerFramesCapabilitiesRoutes(
  app: FastifyInstance,
  opts: { support?: () => Promise<SpeakerFramesRelayAnswer> } = {},
) {
  const support = opts.support ?? (() => speakerFramesRelaySupport())
  app.get("/v1/speaker-frames/capabilities", async (req, reply) => {
    if (!req.userId && !req.isInternalCall) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const { relay, source } = await support()
    return reply.header("Cache-Control", "private, no-store").send({ relay, source })
  })
}
