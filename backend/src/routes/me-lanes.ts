import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { isInAppSession, requestBillingContext, type BillingContext } from "../lib/billing-context.js"
import { lineOfBillingContext } from "../lib/concurrency-lanes/payer.js"
import { laneSizesFor, lastMirroredEnforced } from "../lib/concurrency-lanes/sizes.js"
import type { LaneSizes, PayerKey } from "../lib/concurrency-lanes/types.js"
import { canRunWorkflow } from "../lib/workflow-access.js"

/**
 * The key a deployment payer's line is shown under. The real key names the
 * paying account (`deployment:<its user id>`) — another account, which a
 * caller is not told about. Every user of the install sees this one instead.
 */
export const DEPLOYMENT_LINE_KEY: PayerKey = "deployment:install"

/** `current`: the line the request (or the named workflow's jobs) is billed to — exactly one line. */
export interface MeLanesLine { payer: PayerKey; current: boolean; sizes: LaneSizes }
export interface MeLanes { enforced: boolean; lines: MeLanesLine[] }

const QuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
})

/**
 * The workflow to decide the payer by: `id` when the caller may run it, else
 * none. A workflow the caller cannot reach, one that does not exist, and a
 * failed check all answer none alike.
 */
async function runnableWorkflowId(
  userId: string,
  id: string | undefined,
  log: { warn: (obj: object, msg: string) => void },
): Promise<string | undefined> {
  if (!id) return undefined
  try {
    return (await canRunWorkflow(userId, id)) ? id : undefined
  } catch (err) {
    log.warn({ err }, "me/lanes: could not check the workflow, answering without it")
    return undefined
  }
}

/**
 * GET /v1/me/lanes — whether concurrency lanes are enforced here, and how many
 * jobs of each kind the caller's own lines run at once.
 *
 * `lines` is the caller's personal line first, then — when the request is
 * billed elsewhere — the line it is billed to: the selected workspace's
 * (`x-nodaro-workspace`), or the deployment payer's on an install one account
 * pays for. One line when that is the personal one. The billed line is the one
 * marked `current`. Only the caller's own lines: never another user's, and a
 * deployment line under a fixed key.
 *
 * `?workflowId=` asks for the line that workflow's jobs count in: the payer is
 * then decided as for a generation POST that names it (the workflow's own
 * workspace wins over the header). Only a workflow the caller may run is used;
 * any other id — another user's, or one that does not exist — is ignored alike,
 * and the answer is the header's, so it says nothing about that id.
 *
 * `enforced` is this process's copy of the switch (the enforcement mirror's,
 * refreshed every 30 s; it keeps its last reading while Redis cannot be
 * reached, and is always false while limits cannot be turned on): no Redis
 * call, so a down gate never fails or slows this read.
 *
 * Any signed-in credential. Not declared for a workflow-limited API key, so
 * such a key is refused (middleware/token-workflow-scope.ts): there is no
 * workflow here to narrow to.
 */
export async function meLanesRoutes(app: FastifyInstance) {
  app.get("/v1/me/lanes", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }
    const parsed = QuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "workflowId must be a uuid" } })
    }

    // GETs are not stamped with a payer (registerBillingContextHook skips
    // reads), so ask as a spend request from this client would be decided —
    // the same inputs, and the workflow only when the caller may run it.
    // Resolving never throws today; a failure would still only cost the
    // caller the second line.
    let current: BillingContext | undefined
    try {
      const workflowId = await runnableWorkflowId(userId, parsed.data.workflowId, req.log)
      current = await requestBillingContext({
        userId,
        workspaceId: req.workspaceId,
        workflowId,
        isAppRun: req.isAppRun === true,
        internal: req.authKind === "internal",
        inAppSession: isInAppSession(req),
      })
    } catch (err) {
      req.log.warn({ err }, "me/lanes: the payer could not be resolved, answering the personal line")
      current = undefined
    }

    const personal = lineOfBillingContext(userId, undefined)
    const billed = lineOfBillingContext(userId, current)
    const subjects = billed.payer === personal.payer ? [personal] : [personal, billed]

    const lines: MeLanesLine[] = await Promise.all(
      subjects.map(async (subject) => ({
        payer: subject.payer.startsWith("deployment:") ? DEPLOYMENT_LINE_KEY : subject.payer,
        current: subject.payer === billed.payer,
        sizes: await laneSizesFor(subject),
      })),
    )

    const data: MeLanes = { enforced: lastMirroredEnforced(), lines }
    return reply.send({ data })
  })
}
