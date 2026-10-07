import type { FastifyInstance, FastifyReply, FastifyRequest, preValidationHookHandler } from "fastify"
import { editPlanModeVerdict, type PlannableEditPlanModes } from "../lib/private-plugins/edit-plan-mode-gate.js"
import { plannableEditPlanModes } from "../lib/private-plugins/plannable-edit-plan-modes.js"

/**
 * `POST /v1/edit-plan` refuses an unknown or undeclared Edit Plan mode before
 * anything is charged (decided 2026-10-06), with the message every lane uses
 * (`editPlanModeRefusal`).
 *
 * The route has two owners: the cloud plugin registers it on nodaro.ai, and
 * the relay shim (`nodaro-exclusive.ts`) on a self-host. So the guard is not
 * written into either handler: an `onRoute` hook on the root attaches it as
 * the FIRST `preValidation` of whichever `POST /v1/edit-plan` gets registered.
 * `preValidation` runs before `preHandler`, where the credit guard reserves.
 * Without this, a plugin built before a mode existed answers its own schema's
 * raw 400, and a self-host relays the mode to nodaro.ai.
 *
 * Call it before any route is registered: an `onRoute` hook sees only the
 * routes registered after it (child contexts included).
 *
 * The plannable set is read at REQUEST time — the plugins load after the hook
 * is added — from `plannableEditPlanModes()`, the helper every lane and
 * `GET /v1/edit-plan/capabilities` read (round 6, decided 2026-10-06): the
 * loaded plugin's declaration on nodaro.ai; on a self-host connected to
 * nodaro.ai, what nodaro.ai plans (failing closed to the three original
 * modes); on an unconnected self-host, the three original modes.
 *
 * Round 7 (decided 2026-10-06): on a connected self-host that can't reach
 * nodaro.ai, a KNOWN mode is not refused here — that is a temporary state, and
 * refusing an unsupported mode stays with nodaro.ai's own answer. The job is
 * created, and the video worker's gate fails it retryably ("could not reach
 * nodaro.ai") until nodaro.ai answers or the queue's retries run out.
 */

const EDIT_PLAN_PATH = "/v1/edit-plan"

function refuseUnplannableMode(plannable: PlannableEditPlanModes): preValidationHookHandler {
  return async function editPlanModeGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body
    const mode = body && typeof body === "object" && !Array.isArray(body) ? (body as { mode?: unknown }).mode : undefined
    // An absent mode always passes — no need to ask (or wait for) anyone.
    if (mode === undefined) return
    const verdict = editPlanModeVerdict(mode, await plannable())
    if (verdict.kind === "refuse") {
      return reply.status(400).send({ error: { code: "mode_not_available", message: verdict.message } })
    }
  } as preValidationHookHandler
}

export function registerEditPlanModeGuard(
  app: FastifyInstance,
  plannable: PlannableEditPlanModes = plannableEditPlanModes,
): void {
  const guard = refuseUnplannableMode(plannable)
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    if (route.url !== EDIT_PLAN_PATH || !methods.includes("POST")) return
    const own = route.preValidation
    const ownList: preValidationHookHandler[] = own ? (Array.isArray(own) ? [...own] : [own]) : []
    route.preValidation = [guard, ...ownList]
  })
}
