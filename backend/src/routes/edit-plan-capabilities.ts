import type { FastifyInstance } from "fastify"
import type { PlannableEditPlanModes } from "../lib/private-plugins/edit-plan-mode-gate.js"
import { plannableEditPlanModes } from "../lib/private-plugins/plannable-edit-plan-modes.js"
import { editPlanPerMinuteActive } from "../lib/private-plugins/edit-plan-per-minute.js"

/**
 * GET /v1/edit-plan/capabilities — the Edit Plan modes this server can plan.
 *
 * A mode the server cannot plan (Trailer, on a plugin that predates it) is
 * refused on every lane before anything is charged. The editor asks this route
 * so it can grey that mode out instead of offering a run that is refused.
 * ONE source of truth: the route and every refusing lane read
 * `plannableEditPlanModes()` (`lib/private-plugins/plannable-edit-plan-modes.ts`).
 *
 * Registered on every edition. On nodaro.ai the answer is the loaded plugin's
 * declaration. Round 6 (decided 2026-10-06): a self-hosted install CONNECTED to
 * nodaro.ai answers what nodaro.ai plans (it asks nodaro.ai's own copy of this
 * route over the connection the relay uses, caches it briefly, and falls back to
 * the three original modes when nodaro.ai can't be reached). An unconnected
 * self-host answers the three original modes, as before.
 *
 * Round 7 (decided 2026-10-06): the answer also says who answered —
 * `source: "server" | "nodaro.ai" | "nodaro.ai-unreachable"` — so the editor
 * can say why a mode is greyed out on a self-host ("Available once nodaro.ai
 * supports it", "Couldn't reach nodaro.ai — try again later"). The list itself
 * is unchanged: it still fails closed when nodaro.ai can't be reached.
 *
 * Per started minute (decided 2026-10-07): `perMinute` says whether the
 * loaded plugin charges Edit Plan per started minute
 * (`supports().editPlanPerMinute`, read through `editPlanPerMinuteActive`).
 * The editor then quotes `edit-plan:<mode>:<tier>:<N>m` for N started minutes
 * instead of the step. The standalone orchestrator, which loads no plugin,
 * asks this route over loopback with the internal secret (no user) before it
 * reserves, so it is answered for an internal call too.
 *
 * Read at REQUEST time: `app.ts` registers core routes before it loads the
 * plugins, so a value captured at registration would always be empty.
 */
export async function editPlanCapabilitiesRoutes(
  app: FastifyInstance,
  opts: { plannable?: PlannableEditPlanModes; perMinute?: () => Promise<boolean> } = {},
) {
  const plannable = opts.plannable ?? plannableEditPlanModes
  const perMinuteOf = opts.perMinute ?? (() => editPlanPerMinuteActive())
  app.get("/v1/edit-plan/capabilities", async (req, reply) => {
    if (!req.userId && !req.isInternalCall) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const [{ modes, source }, perMinute] = await Promise.all([plannable(), perMinuteOf()])
    return reply.header("Cache-Control", "private, no-store").send({ modes: [...modes], source, perMinute })
  })
}
