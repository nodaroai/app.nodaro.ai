import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { JOB_SOURCES } from "../../lib/job-source.js"
import { requireAdminInApp } from "../middleware/require-admin-in-app.js"
import { databaseLookup, type OnlineUsersLookup } from "../lib/online-users.js"
import type { PresenceSource } from "../lib/presence.js"
import { databaseUserSurfacesRead, listUserSurfaces, type UserSurfacesRead } from "../lib/user-surfaces-list.js"

/** The kinds of caller the table holds: every job source but the server's own hop. */
const SOURCES = JOB_SOURCES.filter((source): source is PresenceSource => source !== "internal") as [PresenceSource, ...PresenceSource[]]

const listQuery = z.object({ source: z.enum(SOURCES).optional() })

/** The page asks once per kind chosen; this only bounds a runaway client. */
const LIST_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

/**
 * GET /v1/admin/user-surfaces?source= — the surfaces each account has used
 * (`lib/user-surfaces-list.ts`), the newest rows first, one kind of caller or
 * all of them. Up to five hundred accounts' names and emails at a time, so it
 * answers an admin signed in to the app only — never an API token or an app's
 * OAuth token, which `requireAdmin` alone would let through (the users
 * lookup and "Signed in now" draw the same line). The deployment's payer
 * account is never listed to anyone but itself, as there.
 */
export async function adminUserSurfacesRoutes(
  app: FastifyInstance,
  opts: { read?: UserSurfacesRead; lookup?: OnlineUsersLookup } = {},
): Promise<void> {
  const read = opts.read ?? databaseUserSurfacesRead
  const lookup = opts.lookup ?? databaseLookup

  app.get("/v1/admin/user-surfaces", { preHandler: requireAdminInApp, config: LIST_LIMIT }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: `source: one of ${SOURCES.join(", ")}` } })
    }
    const payerId = deploymentPayerId()
    try {
      return await listUserSurfaces({
        read,
        lookup,
        source: parsed.data.source ?? null,
        hiddenUserId: payerId !== null && payerId !== req.userId ? payerId : null,
        onLookupError: (what, err) => req.log.warn({ err, what }, "Surfaces used: could not read names; the list shows ids"),
      })
    } catch (err) {
      // The reason reaches the admin: a table missing its migration is theirs to fix.
      req.log.error({ err }, "Surfaces used: could not read user_surfaces")
      const reason = err instanceof Error ? err.message : String(err)
      return reply.status(503).send({ error: { code: "user_surfaces_unavailable", message: `The surfaces list could not be read: ${reason}` } })
    }
  })
}
