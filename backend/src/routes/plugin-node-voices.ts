import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { readDeclaredNodeVoices } from "../lib/private-plugins/plugin-node-voices.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

/**
 * POST /v1/voices/internal/node-voices — the voices a workflow run of a
 * plugin-served node will speak in, read with the reader the loaded plugin
 * declares for its type (`nodeVoices()`).
 *
 * The voice lock's door for the STANDALONE orchestrator: it runs the workflow
 * engine but loads no plugin, so under a lock it asks this route (this process
 * loaded the plugins) before it creates a plugin speech node's job
 * (`services/workflow-engine/plugin-node-voices-loopback.ts`), then judges the
 * answer exactly as it judges its own speech nodes. The in-process orchestrator
 * reads the same reader directly and never asks.
 *
 * Internal only (the internal secret's caller, never a user, an app token or
 * an API key). Answers `{ voices: string[] }`, or `{ voices: null }` when no
 * reader is declared for the type — the engine then refuses the node under a
 * lock. A reader that fails, or answers anything but a list of voice ids, is a
 * 500: never an empty list.
 *
 * Read at REQUEST time: `app.ts` registers core routes before it loads the
 * plugins, so a reader captured at registration would always be missing.
 */
const nodeVoicesBody = z.object({
  type: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  inputs: z.record(z.string(), z.unknown()),
})

export async function pluginNodeVoicesRoutes(app: FastifyInstance) {
  app.post("/v1/voices/internal/node-voices", async (req, reply) => {
    if (req.authKind !== "internal") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    }
    const parsed = nodeVoicesBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    try {
      const voices = readDeclaredNodeVoices(parsed.data.type, parsed.data.data, parsed.data.inputs)
      return reply.header("Cache-Control", "no-store").send({ voices })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the node's voices")
    }
  })
}
