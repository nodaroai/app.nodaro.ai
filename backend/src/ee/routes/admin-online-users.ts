import type { FastifyInstance } from "fastify"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { databaseLookup, listOnlineUsers, type OnlineUsersLookup } from "../lib/online-users.js"
import { presenceStore } from "../lib/presence-instance.js"
import type { PresenceStore } from "../lib/presence.js"

/** The page asks twice a minute; this only bounds a runaway client. */
const LIST_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

const IN_APP_ONLY = {
  error: { code: "in_app_only", message: "Signed-in users, with their addresses, are listed only to an admin signed in to the app." },
}

/**
 * GET /v1/admin/online-users — who is signed in right now, where, and from
 * which address and country (`lib/presence.ts`). The list carries client IPs,
 * so it answers an admin signed in to the app only: never an API token or an
 * app's OAuth token, which `requireAdmin` alone would let through. The
 * deployment's payer account is never listed to anyone but itself, as on the
 * users page.
 */
export async function adminOnlineUsersRoutes(
  app: FastifyInstance,
  opts: { store?: () => Promise<PresenceStore | null>; lookup?: OnlineUsersLookup } = {},
): Promise<void> {
  const store = opts.store ?? presenceStore
  const lookup = opts.lookup ?? databaseLookup

  app.get("/v1/admin/online-users", { preHandler: requireAdmin, config: LIST_LIMIT }, async (req, reply) => {
    if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
    const payerId = deploymentPayerId()
    return listOnlineUsers({ store: await store(), lookup, hiddenUserId: payerId !== null && payerId !== req.userId ? payerId : null })
  })
}
