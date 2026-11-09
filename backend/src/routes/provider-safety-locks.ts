/**
 * Which models have their content filter forced on by an admin, for a signed-in
 * editor: the node's filter checkbox is shown on and locked for them.
 *
 *   GET /v1/provider-safety/locks   { forcedOn: string[] }
 *
 * Model ids only. Empty where no admin has forced anything, and on an edition
 * without the admin setting.
 */
import type { FastifyInstance } from "fastify"
import { getAppSettings } from "../lib/app-settings.js"

/** The parameter that is a filter a node can opt into, and so a checkbox a setting can lock. */
const NODE_FILTER_PARAM = "nsfw_checker"

export async function providerSafetyLocksRoutes(app: FastifyInstance) {
  app.get("/v1/provider-safety/locks", async () => {
    const overrides = (await getAppSettings()).provider_safety_overrides ?? {}
    const forcedOn = Object.entries(overrides)
      .filter(([, params]) => params[NODE_FILTER_PARAM] === true)
      .map(([modelId]) => modelId)
    return { forcedOn }
  })
}
