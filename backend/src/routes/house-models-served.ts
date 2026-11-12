import type { FastifyInstance } from "fastify"
import { servedHouseModelIds } from "../lib/house-models-served.js"

/**
 * GET /v1/house-models/internal/served — the house models this deployment
 * serves (docs/design/house-models.md): the catalog's own-label ids the loaded
 * plugin lists in `ids()`, and nothing else.
 *
 * The door for the STANDALONE orchestrator: it builds and reserves workflow
 * runs but loads no plugin, so it asks this route (this process loaded the
 * plugins) whether a house model is served before it builds a node's payload
 * (`services/workflow-engine/house-models-served-loopback.ts`). Without the
 * answer its availability rule would refuse every workflow run of a house
 * model that the API and the editor accept.
 *
 * Internal only (the internal secret's caller, never a user, an app token or
 * an API key). Answers `{ ids: string[] }`, read at REQUEST time: `app.ts`
 * registers core routes before it loads the plugins.
 */
export async function houseModelsServedRoutes(app: FastifyInstance) {
  app.get("/v1/house-models/internal/served", async (req, reply) => {
    if (req.authKind !== "internal") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    }
    return reply.header("Cache-Control", "no-store").send({ ids: servedHouseModelIds() })
  })
}
