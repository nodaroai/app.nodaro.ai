import type { FastifyInstance } from "fastify"
import {
  effectiveDeniedNodeTypes,
  effectiveDeniedModelIds,
  effectiveDeniedWebScrapeSources,
  effectiveWorlds,
  modelRestrictionConfigured,
  nodesHiddenFromUsers,
  webScrapeSourcesHiddenFromUsers,
} from "../lib/surface-deny.js"
import { viewerForUser } from "../lib/availability-viewer.js"

/**
 * The EFFECTIVE node/model availability for this deployment (B5) — the
 * browser mirror of the three-layer funnel lib/surface-deny.ts resolves
 * (edition/code → surface-profile factory → admin runtime override). The
 * static profile in /config.js cannot carry the runtime override, so the
 * picker and model dropdowns fetch this once and layer it over their local
 * profile fallback. The backend stays the authority either way: a stale
 * browser list is cosmetic (write/run still refuse).
 *
 * PER VIEWER (nodes). The admin switch hides a node from users, not from the
 * admins who run the deployment: an admin's `denied` list omits what the switch
 * withholds, and `hiddenFromUsers` names it so the picker can mark those — a
 * workflow built on one must not be mistaken for something users can run. A
 * non-admin always gets an empty `hiddenFromUsers`. The answer depends on the
 * caller, hence `private, no-store`.
 *
 * `webScrapeSources` is the same answer for a capability that lives INSIDE a
 * node: Web Scrape's Instagram source follows the Instagram node, and the
 * source dropdown hides what this lists. The rule itself stays here, in
 * lib/surface-deny.ts — the browser is told the result, never the mapping.
 *
 * `worlds` is the same answer for the shared header's worlds: every world, in
 * the profile's display order, enabled when the profile's `worlds.allow` lets
 * it through and every node type it runs is available to this viewer (the
 * table of which node types each world runs is shared data,
 * @nodaro/shared/runtime-config).
 *
 * `models.restricted` says whether the deployment RESTRICTS models
 * (`modelRestrictionConfigured`: a profile `models.allow` / `models.deny`, or a
 * models override that leaves a model off). `models.denied` alone cannot say
 * it: it also carries the rows an admin switched off, which a deployment with
 * no restriction has too. The editor starts a new node on an offered model only
 * where this is true, so a deployment that restricts nothing keeps every
 * node's default exactly as it is.
 */
export async function surfaceAvailabilityRoutes(app: FastifyInstance) {
  app.get("/v1/surface/availability", async (req, reply) => {
    const viewer = await viewerForUser(req.userId)
    return reply.header("Cache-Control", "private, no-store").send({
      nodes: {
        denied: effectiveDeniedNodeTypes(viewer),
        hiddenFromUsers: viewer.admin ? nodesHiddenFromUsers() : [],
      },
      models: { denied: effectiveDeniedModelIds(), restricted: modelRestrictionConfigured() },
      webScrapeSources: {
        denied: effectiveDeniedWebScrapeSources(viewer),
        hiddenFromUsers: viewer.admin ? webScrapeSourcesHiddenFromUsers() : [],
      },
      worlds: effectiveWorlds(viewer),
    })
  })
}
