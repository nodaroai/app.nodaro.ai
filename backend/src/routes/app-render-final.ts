/**
 * POST /v1/app/:slug/runs/:runId/render-final — Render final in the app runner
 * (decided 2026-10-04).
 *
 * An app run whose render made a Preview stopped there: the nodes after the
 * render waited. This renders the final of that run and runs the nodes after
 * it, as a continuation OUTSIDE the run (`services/app-render-final.ts`): the
 * runner pays, with no creator markup, from the app allowance as an app run
 * does. The server computes what runs (the render's Render final set) — a
 * caller names only the render.
 *
 * A CHAIN (decided 2026-10-06): a final stops at a later render still at
 * Preview, and that render offers its own Render final, which continues from
 * the run's NEWEST final — one render at a time. The run links the newest; a
 * newest final that did not complete is not continued: the next one continues
 * from what it continued from (its stamp).
 *
 * With the preview stop rule off for the deployment (`PREVIEW_STOP_RULE_ENABLED`)
 * it is "re-render at Final", as the editor's Render final is then: any render
 * of the run, whatever its take, with nothing asked of a Preview.
 *
 * Refused before anything is written or billed when: the app is a component
 * (a nested graph has no Render final path — permanent); the node is not a
 * render; the run has no completed execution to continue; with the stop rule
 * on, the render's take there is not a Preview (a Final app's tail is the
 * creator's, with markup); a final of this run is already rendering; the
 * overrides re-point an outbound node; with the stop rule on, a Preview further
 * on would stop the final with nobody there to review it; or the runner cannot
 * pay.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CONTINUATION_NOT_COMPLETED, PREVIEW_RENDER_NESTED, PREVIEW_RENDER_NODE_TYPES } from "@nodaro/shared"
import { renderFinalRunSet, renderRunOverrides } from "@nodaro/render-rules"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isUserBlocked } from "../lib/access-blocks.js"
import { hasCredits } from "../lib/config.js"
import { resolveWebSurfaceFlag } from "../middleware/credit-guard.js"
import { MIN_IDEMPOTENCY_KEY_LENGTH } from "../lib/dedup-fingerprint.js"
import { personalPayer, shouldRefuseDegradedRunFor } from "../lib/billing-context.js"
import { describeLockedOverrides, findLockedOverrides } from "../lib/input-override-lock.js"
import { previewReviewRefusal } from "../lib/preview-review-gate.js"
import { previewStopRuleEnabled } from "../lib/preview-stop-rule-flag.js"
import { ACTIVE_EXECUTION_STATUSES } from "../lib/request-helpers.js"
import { appReviewerPresent } from "../lib/app-reviewer.js"
import { appRunFinalContinuedExecution, isAppRenderNode, reviewEditOverrides, stateHoldsPreview } from "../lib/app-run-states.js"
import { appRunFinalChain, finalExecutionIdOf, readAppRunFinals, selectWithFinalExecution } from "../lib/app-run-final-column.js"
import {
  CONTINUATION_REFUSAL_MESSAGE,
  CONTINUATION_REFUSAL_STATUS,
  continuationInputOverrides,
  continuationRefusal,
  continuationRenderStamps,
  continuationSeeds,
  loadContinuationSource,
} from "../services/workflow-engine/run-continuation.js"
import { executeAppRenderFinal } from "../services/app-render-final.js"

/** Stable refusal codes of this route (clients branch on the code). */
export const APP_RENDER_FINAL_NOT_A_RENDER = "not_a_render"
export const APP_RENDER_FINAL_NOT_PREVIEW = "render_final_not_preview"
/** The run's finals could not be read (transient): try again. */
export const APP_RENDER_FINAL_FINALS_UNAVAILABLE = "run_finals_unavailable"

const params = z.object({ slug: z.string().min(1), runId: z.string().uuid() })
const body = z.object({
  renderNodeId: z.string().min(1).max(200),
  reviewer: z.string().max(32).optional(),
})

type SnapshotNode = { id: string; type?: string; data?: Record<string, unknown>; parentId?: string | null }
type SnapshotEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }

export async function appRenderFinalRoutes(app: FastifyInstance) {
  app.post("/v1/app/:slug/runs/:runId/render-final", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsedParams = params.safeParse(req.params)
    const parsedBody = body.safeParse(req.body ?? {})
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid request" } })
    }
    // Off, Render final re-renders at Final, as the editor's does (decided 2026-10-06).
    const stopRule = previewStopRuleEnabled()
    const { slug, runId } = parsedParams.data
    const { renderNodeId } = parsedBody.data
    const userId = req.userId

    // The run: the runner's own, not archived.
    type RunRow = { id: string; app_id: string; execution_id: string | null; node_states: unknown }
    const { data: run, error: runError } = await selectWithFinalExecution<RunRow>("id, app_id, execution_id, node_states", (columns) =>
      supabase.from("app_runs").select(columns).eq("id", runId).eq("runner_id", userId).is("deleted_at", null).maybeSingle() as unknown as PromiseLike<{ // tenant-scope-ignore: scoped by runner_id
        data: RunRow | null
        error: { code?: string | null; message?: string } | null
      }>,
    )
    if (runError) return sendInternalError(reply, req, runError, "Failed to load run")
    if (!run) return reply.status(404).send({ error: { code: "not_found", message: "Run not found" } })

    // The published version it ran, under this slug.
    const { data: version } = await supabase
      // tenant-scope-ignore: published version, verified against the slug/workflow and blocked creator below
      .from("published_apps")
      .select("id, slug, workflow_id, creator_id, publish_type, snapshot_nodes, snapshot_edges")
      .eq("id", run.app_id)
      .is("deleted_at", null)
      .maybeSingle()
    const appRow = version as {
      id: string
      workflow_id: string
      creator_id: string | null
      publish_type: string | null
      snapshot_nodes: SnapshotNode[] | null
      snapshot_edges: SnapshotEdge[] | null
    } | null
    const { data: slugRow } = await supabase
      .from("published_apps")
      .select("workflow_id")
      .eq("slug", slug)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()
    if (!appRow || !slugRow || (slugRow as { workflow_id: string }).workflow_id !== appRow.workflow_id) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }
    if (await isUserBlocked(appRow.creator_id ?? null)) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }
    // A component never stops for a review (permanent): it runs inside its caller's run.
    if (appRow.publish_type === "component") {
      return reply.status(400).send({
        error: { code: PREVIEW_RENDER_NESTED, message: "A component cannot stop for a review, so it has no Render final." },
      })
    }

    const nodes = appRow.snapshot_nodes ?? []
    const edges = appRow.snapshot_edges ?? []
    const render = nodes.find((n) => n.id === renderNodeId)
    if (!isAppRenderNode(render)) {
      return reply.status(400).send({
        error: { code: APP_RENDER_FINAL_NOT_A_RENDER, message: "renderNodeId is not a render node of this app." },
      })
    }
    const runSet = renderFinalRunSet(renderNodeId, nodes, edges)
    if (!run.execution_id || !runSet.has(renderNodeId)) {
      return reply.status(409).send({
        error: { code: CONTINUATION_NOT_COMPLETED, message: CONTINUATION_REFUSAL_MESSAGE[CONTINUATION_NOT_COMPLETED] },
      })
    }

    // What the final continues: the newest final of the run's chain that
    // completed — the one its view lays last (`appRunFinalContinuedExecution`,
    // one rule with the view) — else the run's own execution. One final at a time.
    let continueFrom = run.execution_id
    const newestId = finalExecutionIdOf(run as unknown as Record<string, unknown>)
    if (newestId) {
      const read = await readAppRunFinals([newestId], userId, [run.execution_id], { workflowId: appRow.workflow_id })
      // A failed read is not "no final": continuing from the run's own
      // execution would re-bill what a final already rendered, and unlink it.
      if (!read.complete) {
        return reply.status(503).send({
          error: { code: APP_RENDER_FINAL_FINALS_UNAVAILABLE, message: "Could not read this run's Render finals. Try again in a moment." },
        })
      }
      const newest = read.finals.get(newestId)
      if (newest && (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(newest.status)) {
        return reply.status(409).send({
          error: { code: "already_running", message: "A Render final of this run is already in progress" },
          executionId: newestId,
        })
      }
      continueFrom = appRunFinalContinuedExecution(appRunFinalChain(newestId, read.finals), run.execution_id)
    }

    const typeOf = new Map(nodes.map((n) => [n.id, n.type ?? ""]))
    const source = await loadContinuationSource(continueFrom, {
      withStates: true,
      isRenderNode: (id) => PREVIEW_RENDER_NODE_TYPES.has(typeOf.get(id) ?? ""),
    })
    const nodeIds = [...runSet]
    const refusal = continuationRefusal(source, {
      userId,
      workflowId: appRow.workflow_id,
      appVersionId: appRow.id,
      nodeIds,
    })
    if (refusal || !source) {
      const code = refusal ?? CONTINUATION_NOT_COMPLETED
      return reply.status(CONTINUATION_REFUSAL_STATUS[code]).send({ error: { code, message: CONTINUATION_REFUSAL_MESSAGE[code] } })
    }
    // The stop rule on: only a Preview take waits for a final. A render the
    // newest final already finished there made a Final, and offers none.
    if (stopRule && !stateHoldsPreview(source.nodeStates?.[renderNodeId])) {
      return reply.status(409).send({
        error: {
          code: APP_RENDER_FINAL_NOT_PREVIEW,
          message: "Render final finishes a run whose render made a Preview; this run's render did not.",
        },
      })
    }

    // The render at Final for this run only, and the run's review of its
    // plan (run-result data, TA14) — over the overrides the run applied.
    const sent: Record<string, Record<string, unknown>> = {
      ...reviewEditOverrides(nodes, run.node_states),
      // The one-shot override the editor's and an agent's Render final send.
      ...renderRunOverrides(renderNodeId, "final", runSet),
    }
    const effective = continuationInputOverrides(source, sent)
    const locked = findLockedOverrides(nodes, effective)
    if (locked.length > 0) {
      return reply.status(400).send({ error: { code: "locked_field", message: describeLockedOverrides(locked) } })
    }

    const reviewerPresent = appReviewerPresent(req, { mark: parsedBody.data.reviewer })
    if (stopRule && !reviewerPresent) {
      const runNodeIds = new Set(nodeIds)
      const stop = previewReviewRefusal(nodes, edges, {
        triggerType: "app_run",
        nodeIds,
        inputOverrides: effective,
        savedRenders: (graph) => continuationRenderStamps(graph, continuationSeeds(graph, source, runNodeIds, sent)),
      })
      if (stop) return reply.status(400).send({ error: stop })
    }

    // The payer: the route's authenticated context, as an app run's.
    if (req.billingContext && (await shouldRefuseDegradedRunFor(req.billingContext, appRow.workflow_id))) {
      return reply.status(503).send({
        error: { code: "billing_unavailable", message: "Billing is temporarily unavailable for workspace runs. Try again shortly." },
      })
    }
    if (hasCredits()) {
      // Credits are enterprise: loaded only where the edition has them.
      const { CreditsService } = await import("../ee/billing/credits.js")
      const eligibility = await CreditsService.checkAppRunEligibility(userId)
      if (!eligibility.allowed) {
        return reply.status(402).send({
          error: {
            code: "insufficient_app_credits",
            message: eligibility.error,
            appCreditsAllowance: eligibility.appCreditsAllowance,
          },
        })
      }
    }

    const headerKeyRaw = req.headers["idempotency-key"]
    const headerKey = typeof headerKeyRaw === "string" ? headerKeyRaw.trim() : ""
    try {
      const result = await executeAppRenderFinal({
        runId,
        userId,
        appVersionId: appRow.id,
        workflowId: appRow.workflow_id,
        continueFromExecutionId: continueFrom,
        nodeIds,
        inputOverrides: sent,
        reviewerPresent,
        webFreeMode: await resolveWebSurfaceFlag(req),
        billingContext: req.billingContext ?? personalPayer(userId),
        idempotencyKey: headerKey.length >= MIN_IDEMPOTENCY_KEY_LENGTH ? headerKey : undefined,
      })
      if (result.deduped) reply.header("X-Dedup-Hit", "1")
      return reply.status(result.deduped ? 200 : 202).send({
        executionId: result.executionId,
        runId,
        status: "pending",
        ...(result.deduped ? { deduped: true } : {}),
      })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to start Render final")
    }
  })
}
