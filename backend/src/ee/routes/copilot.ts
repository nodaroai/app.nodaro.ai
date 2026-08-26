/**
 * Workflow Copilot HTTP surface (Cloud only, in-app only).
 *
 * `POST /messages` is the one spending route: it reserves a credit ceiling,
 * opens an SSE stream and runs one turn. Everything else is thread
 * bookkeeping. Runs are never started here — the model proposes, the browser
 * runs through the editor's own Run path.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { config, hasCredits } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { supabase } from "../../lib/supabase.js"
import { createSSEStream } from "../../lib/sse.js"
import { insertJob } from "../../lib/insert-job.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { rateLimiter } from "../../middleware/rate-limit.js"
import { creditGuard, paygSurfaceGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { markProviderCallStart } from "../../lib/reconcile/persistence.js"
import { ensureDefaultProject, PERSONAL_SPACE_DISABLED_ERROR } from "../../lib/default-project.js"
import { redis } from "../../lib/queue.js"
import { effectiveMarkupPercent } from "../billing/service-margin.js"
import { COPILOT_FEATURE, COPILOT_TIERS, RESERVATION_FLOOR_CREDITS, THREAD_CAPS, TURN_CAPS, resolveCopilotTier } from "../copilot/constants.js"
import { runCopilotTurn, TURN_ERROR_TEXT } from "../copilot/turn-runner.js"
import { resolveDefaultTier, resolveEffectiveTierCaps } from "../copilot/tier-settings.js"
import { abortTurnLocally } from "../copilot/cancel-registry.js"
import {
  archiveThread,
  countActiveThreads,
  createThread,
  createTurn,
  findActiveThread,
  findLiveTurn,
  findStaleTurns,
  finishTurn,
  getThreadForUser,
  listMessages,
  requestTurnCancel,
  threadAtTurnCap,
  updateThreadSettings,
  threadAllowsPublishing,
  type CopilotThread,
} from "../copilot/store.js"
import { refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { deleteMemory, listMemories } from "../copilot/memories.js"
import { toDisplayMessages } from "../copilot/display.js"

const createThreadBody = z
  .object({
    workflowId: z.string().uuid().optional(),
    prompt: z.string().min(1).max(THREAD_CAPS.messageMaxChars).optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .refine((b) => Boolean(b.workflowId) || Boolean(b.prompt), {
    message: "Provide workflowId (existing workflow) or prompt (new workflow)",
  })

const messageBody = z.object({
  message: z.string().min(1).max(THREAD_CAPS.messageMaxChars),
  baseVersion: z.number().int().min(1).optional(),
  /**
   * The composer's echo of the thread's model tier — read ONLY by the
   * creditGuard preHandler (which runs before the thread row is loaded) so
   * the balance pre-check uses the right ceiling. The RESERVATION below is
   * authoritative from the thread row; a lying hint moves the pre-check,
   * never the charge. Doubles as the pre-promotion fallback while the
   * `model_tier` column is not on the shared database yet.
   */
  tier: z.enum(["economy", "standard", "premium"]).optional(),
})

const patchThreadBody = z.object({
  runMode: z.enum(["ask", "auto"]).optional(),
  autoRunLimitCredits: z.number().int().min(0).max(100000).optional(),
  modelTier: z.enum(["economy", "standard", "premium"]).optional(),
  /**
   * Let this thread build nodes that publish to the user's connected accounts.
   *
   * Per thread and off by default. It lifts the social publishers only — a
   * webhook or an outbound fetcher stays denied whatever this says, and the
   * model still cannot write which account, which channel, or who can see the
   * result.
   */
  allowPublishing: z.boolean().optional(),
})

interface WorkflowRow {
  id: string
  project_id: string
  name: string
  version: number
  nodes: unknown
  edges: unknown
}

/** In-app only: an OAuth app token, an API token or the internal secret must not drive a user's copilot. */
function requireJwt(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.authKind !== "jwt" || !req.userId) {
    reply.status(403).send({
      error: { code: "in_app_only", message: "The Workflow Copilot is available in the Nodaro app only." },
    })
    return false
  }
  return true
}

/**
 * Access checks run as the FIRST preHandlers on the spending route: a caller
 * we are going to refuse must never reach the rate limiter, the surface guard
 * or (least of all) credit reservation. Fastify stops the chain as soon as a
 * hook sends a reply.
 */
async function accessGate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!requireJwt(req, reply)) return
  await requireEnabled(reply)
}

async function copilotEnabled(): Promise<boolean> {
  if (!config.COPILOT_ENABLED) return false
  const settings = await getAppSettings()
  return settings.copilot_enabled
}

async function requireEnabled(reply: FastifyReply): Promise<boolean> {
  if (await copilotEnabled()) return true
  reply.status(503).send({
    error: { code: "feature_disabled", message: "The Workflow Copilot is temporarily unavailable." },
  })
  return false
}

/** The workflow this thread targets, re-checked as the user's on EVERY request. */
async function loadOwnedWorkflow(workflowId: string, userId: string): Promise<WorkflowRow | null> {
  const { data } = await supabase
    .from("workflows")
    .select("id, project_id, name, version, nodes, edges")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle()
  return (data as WorkflowRow | null) ?? null
}

/** A per-user daily turn budget, independent of the per-minute limiter. */
async function withinDailyTurnCap(userId: string): Promise<boolean> {
  const key = `copilot:turns:${userId}:${new Date().toISOString().slice(0, 10)}`
  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 60 * 60 * 26)
    return count <= THREAD_CAPS.turnsPerUserPerDay
  } catch {
    // Spend route: a cache outage must not remove the cap.
    return false
  }
}

/**
 * Settle any turn whose process died, so a thread is never wedged on a stale
 * `running` row. Cancel FIRST: if the turn is in fact still alive on this or
 * another replica (a heartbeat can lag), refunding it while it keeps working
 * would hand out free model time.
 */
async function healStaleTurns(threadId: string): Promise<void> {
  const { reconcileCopilotTurn } = await import("../copilot/reconcile.js")
  for (const turn of await findStaleTurns(threadId)) {
    await requestTurnCancel(turn.id)
    abortTurnLocally(turn.id, "stale_turn_healed")
    // ONE settle brain: `reconcileCopilotTurn` charges the spend the turn
    // persisted per iteration and refunds only when there was none. A local
    // refund here would disagree with the cron and hand back burned tokens.
    if (turn.job_id) await reconcileCopilotTurn({ id: turn.job_id, reconcile_attempts: 0 })
    // The row must leave `running` whatever the settle brain decided.
    // `reconcileCopilotTurn` returns EARLY when the job was already settled by
    // a live handler, and its own turn update is skipped with it — harmless
    // before migration 348 (a stale row just read as not-live), but with the
    // partial unique index in place a leftover `running` row is a thread
    // wedged at 409 forever, which is exactly what 336's heartbeat design
    // exists to prevent. CAS'd on `status = 'running'`, so a turn the settle
    // brain DID finish is untouched.
    await finishTurn(turn.id, "failed", { error: "turn_abandoned" })
  }
}

export async function registerCopilotRoutes(app: FastifyInstance): Promise<void> {
  if (!hasCredits()) return

  // -------------------------------------------------------------------------
  // POST /v1/copilot/threads
  // -------------------------------------------------------------------------
  app.post(
    "/v1/copilot/threads",
    { preHandler: rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "copilot-threads" }) },
    async (req, reply) => {
      if (!requireJwt(req, reply)) return
      if (!(await requireEnabled(reply))) return
      const parsed = createThreadBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
      }
      const userId = req.userId!

      if ((await countActiveThreads(userId)) >= THREAD_CAPS.activeThreadsPerUser) {
        return reply.status(409).send({
          error: { code: "thread_cap_reached", message: "You have too many open copilot conversations. Close one and try again." },
        })
      }

      try {
        let workflow: WorkflowRow | null = null
        let seededWorkflow = false

        if (parsed.data.workflowId) {
          workflow = await loadOwnedWorkflow(parsed.data.workflowId, userId)
          if (!workflow) {
            return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
          }
        } else {
          const project = await ensureDefaultProject(userId)
          if ("error" in project) {
            return sendInternalError(reply, req, new Error(project.error), "Failed to resolve your default project")
          }
          if ("personalSpaceDisabled" in project) {
            return reply.status(403).send({ error: PERSONAL_SPACE_DISABLED_ERROR })
          }
          const name = parsed.data.name ?? parsed.data.prompt!.slice(0, 60)
          const { data, error } = await supabase
            .from("workflows")
            .insert({
              user_id: userId,
              project_id: project.projectId,
              name,
              nodes: [],
              edges: [],
              source_prompt: parsed.data.prompt,
            })
            .select("id, project_id, name, version, nodes, edges")
            .single()
          if (error) return sendInternalError(reply, req, error, "Failed to create workflow")
          workflow = data as WorkflowRow
          seededWorkflow = true
        }

        const existing = await findActiveThread(userId, workflow.id)
        // `seededWorkflow` is what lets the sweep tell a workflow this
        // handshake CREATED from one the user opened the copilot on (#904).
        const thread =
          existing ??
          (await createThread(userId, workflow.id, {
            createdWorkflow: seededWorkflow,
            // The admin's default tier, baked in at birth (see createThread).
            modelTier: await resolveDefaultTier(),
          }))
        return reply.status(existing ? 200 : 201).send({
          data: {
            thread: publicThread(thread),
            workflow: { id: workflow.id, projectId: workflow.project_id, name: workflow.name, version: workflow.version },
          },
        })
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to start a copilot conversation")
      }
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/copilot/threads?workflowId=…
  // -------------------------------------------------------------------------
  app.get("/v1/copilot/threads", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const workflowId = (req.query as { workflowId?: string }).workflowId
    if (!workflowId) {
      return reply.status(400).send({ error: { code: "validation_error", message: "workflowId is required" } })
    }
    const thread = await findActiveThread(req.userId!, workflowId)
    return reply.send({ data: { thread: thread ? publicThread(thread) : null } })
  })

  // -------------------------------------------------------------------------
  // GET /v1/copilot/threads/:id
  // -------------------------------------------------------------------------
  app.get("/v1/copilot/threads/:id", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const { id } = req.params as { id: string }
    const thread = await getThreadForUser(id, req.userId!)
    if (!thread) return reply.status(404).send({ error: { code: "not_found", message: "Thread not found" } })

    const query = req.query as { after?: string; limit?: string }
    const after = query.after ? Number(query.after) : undefined
    const limit = Math.min(Number(query.limit ?? 200) || 200, 200)
    const [rows, live] = await Promise.all([
      listMessages(id, { after: Number.isFinite(after) ? after : undefined, limit }),
      findLiveTurn(id),
    ])

    return reply.send({
      data: {
        thread: { ...publicThread(thread), status: live ? "running" : "idle", activeTurnId: live?.id ?? null },
        messages: toDisplayMessages(rows),
      },
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /v1/copilot/threads/:id  — run mode + auto-run limit
  // -------------------------------------------------------------------------
  app.patch("/v1/copilot/threads/:id", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const parsed = patchThreadBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid body" } })
    }
    const { id } = req.params as { id: string }
    const updated = await updateThreadSettings(id, req.userId!, {
      ...(parsed.data.runMode ? { run_mode: parsed.data.runMode } : {}),
      ...(parsed.data.autoRunLimitCredits !== undefined ? { auto_run_limit_credits: parsed.data.autoRunLimitCredits } : {}),
      ...(parsed.data.modelTier ? { model_tier: parsed.data.modelTier } : {}),
      ...(parsed.data.allowPublishing !== undefined ? { allow_publishing: parsed.data.allowPublishing } : {}),
    })
    if (!updated) return reply.status(404).send({ error: { code: "not_found", message: "Thread not found" } })
    return reply.send({ data: { thread: publicThread(updated) } })
  })

  // -------------------------------------------------------------------------
  // DELETE /v1/copilot/threads/:id — archive
  // -------------------------------------------------------------------------
  app.delete("/v1/copilot/threads/:id", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const { id } = req.params as { id: string }
    const thread = await getThreadForUser(id, req.userId!)
    if (!thread) return reply.status(404).send({ error: { code: "not_found", message: "Thread not found" } })
    if (await findLiveTurn(id)) {
      return reply.status(409).send({ error: { code: "turn_in_progress", message: "Wait for the current turn to finish." } })
    }
    await archiveThread(id, req.userId!)
    return reply.send({ data: { archived: true } })
  })

  // -------------------------------------------------------------------------
  // GET /v1/copilot/memories — "what the copilot remembers" (per-user, M1)
  // -------------------------------------------------------------------------
  app.get("/v1/copilot/memories", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    // Table-tolerant by construction: before migration 343 reaches the shared
    // database, this is an empty list, never an error.
    const memories = await listMemories(req.userId!)
    return reply.send({ data: { memories } })
  })

  // -------------------------------------------------------------------------
  // DELETE /v1/copilot/memories/:id — the undo, and the panel's delete
  // -------------------------------------------------------------------------
  app.delete("/v1/copilot/memories/:id", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const { id } = req.params as { id: string }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid memory id" } })
    }
    const deleted = await deleteMemory(req.userId!, id)
    if (!deleted) return reply.status(404).send({ error: { code: "not_found", message: "Memory not found" } })
    return reply.send({ data: { deleted: true } })
  })

  // -------------------------------------------------------------------------
  // POST /v1/copilot/threads/:id/cancel
  // -------------------------------------------------------------------------
  app.post("/v1/copilot/threads/:id/cancel", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const { id } = req.params as { id: string }
    const thread = await getThreadForUser(id, req.userId!)
    if (!thread) return reply.status(404).send({ error: { code: "not_found", message: "Thread not found" } })
    const live = await findLiveTurn(id)
    if (!live) return reply.status(409).send({ error: { code: "no_active_turn", message: "Nothing is running." } })
    await requestTurnCancel(live.id)
    abortTurnLocally(live.id, "cancelled_by_user")
    return reply.send({ data: { cancelling: true, turnId: live.id } })
  })

  // -------------------------------------------------------------------------
  // POST /v1/copilot/threads/:id/messages  — SSE
  // -------------------------------------------------------------------------
  app.post(
    "/v1/copilot/threads/:id/messages",
    {
      preHandler: [
        accessGate,
        rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "copilot-messages", failClosed: true }),
        paygSurfaceGuard(),
        creditGuard((req) => tierSpecFromBody(req).creditId, {
          dedup: false,
          // Reserve the ceiling, but never more than the user actually has:
          // a low balance should shorten a turn, not refuse it outright.
          computeCredits: async (_body, req) => resolveReservation(req),
        }),
      ],
    },
    async (req, reply) => {
      // Access and the kill switch were settled by `accessGate` above.
      const parsed = messageBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Invalid body" } })
      }
      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "The assistant is not configured." } })
      }

      const userId = req.userId!
      const { id: threadId } = req.params as { id: string }
      const thread = await getThreadForUser(threadId, userId)
      if (!thread) return reply.status(404).send({ error: { code: "not_found", message: "Thread not found" } })
      if (thread.archived_at) {
        return reply.status(409).send({ error: { code: "thread_archived", message: "This conversation is closed." } })
      }
      if (threadAtTurnCap(thread)) {
        return reply.status(409).send({ error: { code: "thread_cap_reached", message: "This conversation reached its length limit. Start a new one." } })
      }

      const workflow = await loadOwnedWorkflow(thread.workflow_id, userId)
      if (!workflow) return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
      if (parsed.data.baseVersion !== undefined && parsed.data.baseVersion !== workflow.version) {
        return reply.status(409).send({
          error: { code: "workflow_stale", message: "The workflow changed. Save or reload, then send again." },
          currentVersion: workflow.version,
        })
      }

      // The thread row is the tier authority; the body hint covers the window
      // before the `model_tier` column reaches the shared database.
      const tier = resolveCopilotTier(
        (thread as { model_tier?: unknown }).model_tier ?? parsed.data.tier,
      )
      // Model and pricing stay compiled; the CAPS are the admin's, merged over
      // the defaults. Building one effective spec means every downstream reader
      // that already reads `tierSpec.caps` — the hard-stop timer here, the loop
      // — gets the override with no new plumbing.
      const effectiveCaps = (await resolveEffectiveTierCaps())[tier]
      const tierSpec = { ...COPILOT_TIERS[tier], caps: effectiveCaps }

      await healStaleTurns(threadId)
      if (await findLiveTurn(threadId)) {
        return reply.status(409).send({ error: { code: "turn_in_progress", message: "The copilot is still working on the previous message." } })
      }
      if (!(await withinDailyTurnCap(userId))) {
        return reply.status(429).send({ error: { code: "daily_limit_reached", message: "You've reached today's copilot limit." } })
      }

      const { data: job, error: jobError } = await insertJob(req, {
        // Deliberately NOT workflow_id: this job is the conversation turn, not
        // a node run, and the editor's execution list reads workflow-scoped jobs.
        user_id: userId,
        status: "processing",
        input_data: { feature: COPILOT_FEATURE, threadId, workflowId: workflow.id },
      })
      if (jobError) return sendInternalError(reply, req, jobError, "Failed to start the turn")

      const reservation = await reserveCreditsForJob(req, reply, job.id, tierSpec.creditId)
      if (reply.sent) return
      await markProviderCallStart(job.id, "copilot-turn")

      const turn = await createTurn({
        threadId,
        userId,
        modelId: tierSpec.registryId,
        jobId: job.id,
        baseVersion: workflow.version,
      })
      // The claim was lost inside the check-then-act window: another request
      // passed the same `findLiveTurn` above and wrote its turn row first, and
      // migration 348's partial unique index refused this one (#903).
      //
      // Everything spent getting here has to come back, in the order the live
      // path uses: release the reservation, then settle the job. Without the
      // refund this branch would MOVE the double charge rather than fix it,
      // and a job left at `processing` with `provider_kind = "copilot-turn"`
      // would be re-scanned by the reconcile cron every 15 minutes.
      if (!turn) {
        await refundReservedCreditsForJob(job.id)
        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: "Another copilot turn claimed this conversation first. Nothing was charged.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          // This request minted the row seconds ago for this user, so the
          // owner filter changes nothing today. It is in the chain because
          // ownership a reader has to reconstruct from three lines up is
          // ownership the next edit can quietly drop.
          .eq("user_id", userId)
          .in("status", ["pending", "processing"])
        return reply.status(409).send({ error: { code: "turn_in_progress", message: "The copilot is still working on the previous message." } })
      }

      const sse = await createSSEStream(req, reply)
      const abort = new AbortController()
      req.raw.once("close", () => abort.abort())

      sse.sendEvent({
        type: "metadata",
        data: {
          threadId,
          turnId: turn.id,
          jobId: job.id,
          model: tierSpec.registryId,
          modelTier: tier,
          baseVersion: workflow.version,
          runMode: thread.run_mode,
          autoRunLimitCredits: thread.auto_run_limit_credits,
          // A second tab that changed this is otherwise showing a permission
          // the user already withdrew. It cannot ACT on the stale value — the
          // server reads the row on every turn — but a checkbox that lies
          // about a permission is its own problem.
          allowPublishing: threadAllowsPublishing(thread),
        },
      })

      const hardStop = setTimeout(() => abort.abort(), tierSpec.caps.hardTimeoutMs)
      try {
        const outcome = await runCopilotTurn({
          req,
          fastify: app,
          thread,
          turn,
          userId,
          workflowId: workflow.id,
          projectId: workflow.project_id,
          workflowName: workflow.name,
          version: workflow.version,
          nodes: workflow.nodes,
          edges: workflow.edges,
          message: parsed.data.message,
          tier,
          caps: effectiveCaps,
          usageLogId: reservation?.usageLogId ?? null,
          reservedCredits: reservation?.creditsReserved ?? 0,
          emit: (event) => sse.sendEvent(event as never),
          signal: abort.signal,
        })

        sse.sendEvent({
          type: "usage",
          data: {
            inputTokens: outcome.usage.inputTokens,
            outputTokens: outcome.usage.outputTokens,
            cacheReadTokens: outcome.usage.cacheReadTokens,
            creditsCharged: outcome.creditsCharged,
          },
        })
        if (outcome.status === "failed") {
          sse.sendEvent({
            type: "error",
            data: {
              code: outcome.error?.code ?? "internal_error",
              // Fixed map only — an unmapped code must not put `undefined` on
              // the wire (SSE bypasses the 500 sanitizer).
              message: TURN_ERROR_TEXT[outcome.error?.code ?? ""] ?? TURN_ERROR_TEXT.internal_error!,
            },
          })
        } else {
          sse.sendEvent({
            type: "done",
            data: {
              turnId: turn.id,
              messageId: outcome.assistantMessageId,
              status: outcome.status,
              finalVersion: outcome.finalVersion,
            },
          })
        }
      } catch (err) {
        req.log.error({ err, turnId: turn.id }, "[copilot] turn crashed")
        sse.sendEvent({ type: "error", data: { code: "internal_error", message: TURN_ERROR_TEXT.internal_error! } })
      } finally {
        clearTimeout(hardStop)
        sse.close()
      }
    },
  )
}

/**
 * Reservation = the ceiling, shortened to what the user actually has so a low
 * balance yields a shorter turn instead of a refusal.
 *
 * Two subtleties, both learned the hard way:
 *  - `creditGuard` multiplies this by the service rate before checking the
 *    balance, so clamping to the RAW balance would still 402. Divide it out.
 *  - Below the floor there is no useful turn to run: reserve the floor and let
 *    the guard answer 402 with a number the user can act on.
 */
/**
 * The tier the GUARD stage can know: the composer's body hint (the thread row
 * is not loaded yet at preHandler time). The handler re-resolves from the
 * thread row, which stays authoritative for the reservation IDENTIFIER; this
 * hint prices the guard's balance pre-check and the reservation CEILING. A
 * lying hint only misprices the caller's own reservation — the commit is
 * metered on actuals either way, so nothing can be overcharged.
 */
function tierSpecFromBody(req: FastifyRequest) {
  return COPILOT_TIERS[resolveCopilotTier((req.body as { tier?: unknown } | null)?.tier)]
}

export async function resolveReservation(req: FastifyRequest): Promise<number> {
  const { CreditsService, getModelCreditBaseCost } = await import("../billing/credits.js")
  // The DB row wins, exactly as it does for every other priced identifier —
  // an admin raising the ceiling in /admin/models must move the reservation.
  // A missing row throws PriceNotConfiguredError, which creditGuard turns
  // into the 503 the hard-fail policy specifies.
  // Tier-aware: the ceiling row of the RUNG, not the bare feature — this
  // number becomes the reservation (via creditOverride) and therefore the
  // turn's USD budget. Pricing premium at the standard row would quietly cap
  // an Opus turn at a Sonnet budget — the ladder's whole promise.
  const tierCreditId = tierSpecFromBody(req).creditId
  const ceiling = (await getModelCreditBaseCost(tierCreditId)).creditCost
  const userId = req.userId
  if (!userId) return ceiling
  try {
    const [balance, settings] = await Promise.all([CreditsService.getBalance(userId), getAppSettings()])
    const ratePercent = effectiveMarkupPercent(settings, tierCreditId)
    const affordableBase = Math.floor(balance.total / (1 + ratePercent / 100))
    if (affordableBase < RESERVATION_FLOOR_CREDITS) return RESERVATION_FLOOR_CREDITS
    return Math.min(ceiling, affordableBase)
  } catch {
    return ceiling
  }
}

/**
 * The thread, narrowed for the browser.
 *
 * An explicit allowlist, and load-bearing as one: the row is read with
 * `select("*")` — because naming a column that a not-yet-promoted migration has
 * not added would 500 every read on staging — so this mapper is the only thing
 * standing between "a new column exists" and "a new column is public". Add
 * fields here deliberately, never by spreading the row.
 */
function publicThread(thread: CopilotThread): Record<string, unknown> {
  return {
    id: thread.id,
    workflowId: thread.workflow_id,
    runMode: thread.run_mode,
    // Column-tolerant: standard until migration 344 reaches the shared DB.
    modelTier: resolveCopilotTier((thread as { model_tier?: unknown }).model_tier),
    allowPublishing: threadAllowsPublishing(thread),
    autoRunLimitCredits: thread.auto_run_limit_credits,
    userTurnCount: thread.user_turn_count,
    lastMessageAt: thread.last_message_at,
    createdAt: thread.created_at,
  }
}
