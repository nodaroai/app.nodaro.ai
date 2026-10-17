/**
 * Continue a use-case run (podcast use-case nodes, decided 2026-10-13): a NEW
 * wrapper job whose hidden run continues the earlier run's inner execution,
 * on that run's stored snapshot. One `<route>/continue` per registered type;
 * a run is continued only through its own type's route.
 *
 *  - from-failed: runs every step the failed run did not complete; the
 *    completed ones are handed on, never run or billed again. The run's fee
 *    is held again on the new wrapper — the failed run's was refunded — so a
 *    run is charged its fee once overall. A Render final's chain has none.
 *  - render-final: after a review-on run held its preview, renders the
 *    delivery at Final and runs what follows the render, with the reviewer's
 *    edited plan. No fee: one fee per run.
 *
 * Every refusal (someone else's run, a run in the wrong state, a snapshot that
 * is gone or does not match, a second Render final of one run, a balance that
 * cannot cover what the run still executes) happens before any row or credit
 * hold. Requests arriving at once are settled by a claim on the lineage's root
 * (a first run's continues) or on the preview run (a Render final and its
 * continues) — lib/use-case/continue-claim.ts: one wins, the others are
 * refused, and every failure before the run starts gives the claim back. What
 * runs is worked out in lib/use-case/continuation.ts.
 */
import { randomUUID } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseFeeCreditId, type UseCaseNodeType } from "@nodaro/render-rules"
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared/nodes"
import { previewRefusalMessage } from "../lib/preview-refusal-copy.js"
import { hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { insertJob, insertJobIdempotent } from "../lib/insert-job.js"
import { KEYED_JOB_COLUMNS, keyedJobOf } from "../lib/dedup-fingerprint.js"
import { creditGuard, reserveCreditsForJob, resolveWebSurfaceFlag } from "../middleware/credit-guard.js"
import { isNodeDeniedForUser } from "../lib/availability-viewer.js"
import { deniedNodeRejectionMessage } from "../lib/surface-deny.js"
import { ensureInlineGraphColumns } from "../lib/execution-inline-graph.js"
import { markJobFailed } from "../lib/job-failure.js"
import { refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { RENDER_FINAL_ALREADY_RUNNING, renderFinalCredits } from "../lib/render-final-run.js"
import { claimContinuation, releaseContinuation, type ContinueClaim } from "../lib/use-case/continue-claim.js"
import {
  IDEMPOTENCY_KEY_REUSED,
  USE_CASE_MAX_DEPTH,
  adoptForwardedPayer,
  idempotencyKeyOf,
  isInternalLane,
  usecaseKeyedRetry,
  usecaseKeyedRunIsOwn,
  usecaseUnavailable,
} from "../lib/use-case/lanes.js"
import { usecaseContinueBody, usecaseReviewerPresent } from "../lib/use-case/request.js"
import { resolveUseCaseContinuation, type UseCaseContinuation } from "../lib/use-case/continuation.js"
import { fromFailedCover } from "../lib/use-case/continue-credits.js"
import { continuationInputOverrides } from "../services/workflow-engine/run-continuation.js"
import { executeInlineGraph, InlineGraphUnavailableError } from "../services/use-case-execution.js"

const STAMP_ATTEMPTS = 3

/** Stamp the wrapper with its run, a few times before giving up. Never throws. */
async function stampRun(wrapperId: string, userId: string, inputData: Record<string, unknown>): Promise<void> {
  for (let attempt = 1; attempt <= STAMP_ATTEMPTS; attempt++) {
    let message: string
    try {
      const { error } = await supabase.from("jobs").update({ input_data: inputData }).eq("id", wrapperId).eq("user_id", userId)
      if (!error) return
      message = error.message
    } catch (err) {
      message = (err as Error).message
    }
    if (attempt === STAMP_ATTEMPTS) {
      console.warn(`[use-case-continue] wrapper ${wrapperId} not stamped with run ${String(inputData._executionId)}: ${message}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
  }
}

function registerContinue(app: FastifyInstance, type: UseCaseNodeType): void {
  const FEE_ID = usecaseFeeCreditId(type)
  app.post(
    usecaseContinuePath(type),
    { preHandler: [adoptForwardedPayer, usecaseKeyedRetry(type), creditGuard(() => FEE_ID)] },
    async (req, reply) => {
      const parsed = usecaseContinueBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      const userId = req.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      if (await isNodeDeniedForUser(type, userId)) {
        return reply.status(403).send({ error: { code: "node_not_available", message: deniedNodeRejectionMessage([type]) } })
      }
      const body = parsed.data
      const internal = isInternalLane(req)
      if (internal && (body.componentDepth ?? 0) >= USE_CASE_MAX_DEPTH) {
        return reply
          .status(400)
          .send({ error: { code: "nesting_too_deep", message: `Nodes inside components can nest ${USE_CASE_MAX_DEPTH} levels deep.` } })
      }
      if (!(await ensureInlineGraphColumns())) return reply.status(503).send({ error: usecaseUnavailable(type) })

      let plan: UseCaseContinuation
      try {
        const resolved = await resolveUseCaseContinuation({ nodeType: type, jobId: body.jobId, userId, mode: body.mode, editedEdl: body.editedEdl })
        if (!resolved.ok) {
          return reply
            .status(resolved.status)
            .send({ error: { code: resolved.code, message: resolved.message }, ...(resolved.jobId ? { jobId: resolved.jobId } : {}) })
        }
        plan = resolved
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to continue the run")
      }
      // A resumed preview inside another run with nobody to review it would
      // hold a preview no one sees — refused as the run route refuses it.
      if (internal && plan.reviewBeforeRender && body.reviewerPresent !== true) {
        return reply.status(409).send({ error: { code: PREVIEW_REVIEW_REQUIRED, message: previewRefusalMessage("headless", "review") } })
      }
      const billingContext = req.billingContext

      const webFreeMode = req.webFreeMode === true || (await resolveWebSurfaceFlag(req))
      // From-failed: the balance must cover what the run still executes plus
      // the fee it holds, priced on the graph it executes (the earlier run's
      // pin applied) — the run route's whole-run check, for the rest of a run.
      if (body.mode === "from-failed") {
        try {
          const cover = await fromFailedCover({
            userId,
            graph: plan.graph,
            nodeIds: plan.nodeIds,
            overrides: continuationInputOverrides(plan.source, undefined),
            feeCredits: hasCredits() ? plan.feeCredits : 0,
            billingContext,
            webFreeMode,
          })
          if (cover && !cover.ok) return reply.status(402).send({ error: { code: "insufficient_credits", message: cover.message } })
        } catch (err) {
          return sendInternalError(reply, req, err, "Failed to continue the run")
        }
      }
      // Render final: the balance must cover the run, priced on the graph it
      // executes (the earlier run's pin with this run's overrides over it) by
      // the one funnel every Render final quote and run reads.
      if (body.mode === "render-final") {
        try {
          const credits = await renderFinalCredits({
            userId,
            nodes: plan.graph.nodes.map((n) => ({ ...n, data: { ...n.data } })),
            edges: plan.graph.edges.map((e) => ({ ...e })),
            runNodeIds: plan.nodeIds,
            overrides: continuationInputOverrides(plan.source, plan.inputOverrides),
            surface: { billingContext, webFreeMode },
          })
          if (credits && !credits.sufficient) {
            const message = credits.message ?? `Render final is estimated at about ${credits.estimatedCredits} credits.`
            return reply.status(402).send({ error: { code: "insufficient_credits", message } })
          }
        } catch (err) {
          return sendInternalError(reply, req, err, "Failed to continue the run")
        }
      }

      // The fee held is the run's own fee, as its first wrapper recorded it.
      const feeCredits = hasCredits() ? plan.feeCredits : 0
      if (feeCredits > 0) {
        req.creditReservation = { usageLogId: "", creditsReserved: 0, watermark: false, ...req.creditReservation, creditOverride: feeCredits }
      }
      const inputData = {
        type,
        mode: body.mode,
        sourceJobId: body.jobId,
        settings: plan.input.settings ?? {},
        mediaUrl: plan.input.mediaUrl ?? null,
        ...(plan.input.musicUrl !== undefined ? { musicUrl: plan.input.musicUrl } : {}),
        ...(plan.input.introCardUrl !== undefined ? { introCardUrl: plan.input.introCardUrl } : {}),
        ...(plan.input.durationSec !== undefined ? { durationSec: plan.input.durationSec } : {}),
        ...(plan.finalChain ? { _finalChain: true } : {}),
        ...(plan.finalOf ? { _finalOf: plan.finalOf } : {}),
        ...(plan.finalEdit ? { _finalEdit: plan.finalEdit } : {}),
        ...(plan.chainOf ? { _chainOf: plan.chainOf } : {}),
        _feeCredits: feeCredits,
      }
      // Never `workflow_execution_id`: the wrapper reaches its run only through
      // `input_data._executionId` (and the run's own pointer back).
      const newWrapperId = randomUUID()
      const wrapperRow = {
        id: newWrapperId,
        user_id: userId,
        provider: "use-case",
        job_type: type,
        status: "processing",
        started_at: new Date().toISOString(),
        input_data: inputData,
        ...(body.workflowId ? { workflow_id: body.workflowId } : {}),
        ...(body.nodeId ? { node_id: body.nodeId } : {}),
      }
      // The claim, last before anything is written: of two requests at once,
      // exactly one gets past here.
      let claim: ContinueClaim
      try {
        const claimed = await claimContinuation({ rowId: plan.claim.rowId, userId, key: plan.claim.key, newWrapperId })
        if (!claimed.ok) {
          const message = plan.finalChain ? "A Render final of this run is already in progress." : "This run is already being continued."
          return reply.status(409).send({ error: { code: RENDER_FINAL_ALREADY_RUNNING, message }, jobId: claimed.blockedBy })
        }
        claim = claimed.claim
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to continue the run")
      }

      const headerKey = idempotencyKeyOf(req)
      let wrapperId: string
      try {
        if (headerKey) {
          const dedup = await insertJobIdempotent<{ id: string } & Record<string, unknown>>(req, wrapperRow, headerKey, KEYED_JOB_COLUMNS)
          if (!dedup.created) {
            await releaseContinuation(claim)
            // The key is taken (another request won the race to it): only a run
            // of this type answers; any other job under it refuses the request.
            if (!usecaseKeyedRunIsOwn(keyedJobOf(dedup.row), type)) {
              return reply.status(409).send({ error: IDEMPOTENCY_KEY_REUSED })
            }
            reply.header("X-Dedup-Hit", "1")
            return reply.status(202).send({ jobId: dedup.row.id, deduped: true })
          }
          wrapperId = dedup.row.id
        } else {
          const inserted = await insertJob(req, wrapperRow)
          if (inserted.error) {
            await releaseContinuation(claim)
            return sendInternalError(reply, req, inserted.error, "Failed to continue the run")
          }
          wrapperId = inserted.data.id
        }
      } catch (err) {
        await releaseContinuation(claim)
        return sendInternalError(reply, req, err, "Failed to continue the run")
      }

      if (feeCredits > 0) {
        try {
          await reserveCreditsForJob(req, reply, wrapperId, FEE_ID)
        } catch (err) {
          // The wrapper fails, any hold the throw left behind is refunded
          // (idempotent: only a reserved hold moves), the claim goes back.
          await markJobFailed(wrapperId, { error_message: "The run's fee could not be held", from: ["processing"] })
          await refundReservedCreditsForJob(wrapperId)
          await releaseContinuation(claim)
          return sendInternalError(reply, req, err, "Failed to continue the run")
        }
        if (reply.sent) {
          // The hold was refused (its own reply says why). A refused hold has
          // already removed the row; this only covers one that kept it.
          await markJobFailed(wrapperId, { error_message: "The run's fee could not be held", from: ["processing"] })
          await releaseContinuation(claim)
          return
        }
      }

      // Who can review: a resumed review-on first part may hold its preview
      // again for its caller; a run that renders the delivery never holds one.
      const review = { reviewBeforeRender: plan.reviewBeforeRender }
      let executionId: string
      try {
        const started = await executeInlineGraph({
          userId,
          graph: plan.graph,
          wrapperJobId: wrapperId,
          billingContext,
          componentDepth: internal ? (body.componentDepth ?? 0) : 0,
          executingComponentIds: internal ? (body.executingComponentIds ?? []) : [],
          reviewerPresent: usecaseReviewerPresent(review, { internal, forwarded: body.reviewerPresent }),
          ...(internal && body.previewStopRule !== undefined ? { previewStopRule: body.previewStopRule } : {}),
          nodeIds: plan.nodeIds,
          continueFromExecutionId: plan.sourceExecutionId,
          ...(body.mode === "from-failed" ? { continueMode: "from-failed" as const } : {}),
          ...(plan.inputOverrides ? { inputOverrides: plan.inputOverrides } : {}),
          idempotencyKey: `uc-exec-${wrapperId}`,
          mcpClient: extractMcpClient(req.body),
          // The run's steps reserve under the rules its balance check and fee hold used.
          webFreeMode,
          appRun: req.isAppRun === true,
        })
        executionId = started.executionId
      } catch (err) {
        // Only a run that never started unwinds the wrapper and its fee.
        if (await markJobFailed(wrapperId, { error_message: "The run could not continue", from: ["processing"] })) {
          await refundReservedCreditsForJob(wrapperId)
        }
        await releaseContinuation(claim)
        if (err instanceof InlineGraphUnavailableError) return reply.status(503).send({ error: usecaseUnavailable(type) })
        return sendInternalError(reply, req, err, "Failed to continue the run")
      }

      // The run is live from here: a stamp that fails (or throws) never fails
      // the wrapper or refunds its fee. It is tried a few times; one that never
      // lands is written by the finaliser as the wrapper settles, and until
      // then the run's own pointer names its wrapper (the sweep, a cancel).
      await stampRun(wrapperId, userId, { ...inputData, _executionId: executionId })
      return reply.status(202).send({ jobId: wrapperId, executionId })
    },
  )
}

/** One continue route per registered use-case type. */
export async function usecaseContinueRoutes(app: FastifyInstance) {
  for (const type of USE_CASE_NODE_TYPES) registerContinue(app, type)
}
