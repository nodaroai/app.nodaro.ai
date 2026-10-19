// @registry-enumerates prices the Retry by estimateRunSetCredits over whatever node types the app graph holds, and asks CreditsService for the run's eligibility
/**
 * POST /v1/app/:slug/runs/:runId/resume — Retry of a FAILED app run, continued
 * from where it stopped (decided 2026-10-18).
 *
 * A Retry used to start the run again from nothing: every step and every clip
 * rendered and was charged a second time. It now CONTINUES the failed
 * execution: every step the run completed hands on its output (seeded from
 * that execution's states), and only what it did not complete runs and is
 * charged — the engine's continue-from-failed (`fromFailedClosedRunSet`,
 * `continuationSeeds`), on the app's own lane. A UGC Clip that failed renders
 * only the clips it did not finish: the Retry is the same run going on, so its
 * clips are keyed by the run's chain root (lib/continuation-run-root.ts) and
 * the clip route hands the finished ones back.
 *
 * The Retry is the RUN going on, not a run beside it: the run's pointer
 * (`app_runs.execution_id`) moves to the new execution, which is stamped with
 * the run and with the execution it continues (`appRunResumeStamp`). It runs
 * the app version the failed run ran, with the inputs that run applied (its
 * pin): nothing in the body changes what runs. That version must still be the
 * one the runner is on (`version`, default the app's latest): after the app
 * changed, a Retry would continue an old snapshot the runner no longer sees,
 * so it is refused (`app_run_version_changed`). Starting over (new inputs, the
 * app's current version) is the ordinary run of the draft
 * (`POST /v1/app/:slug/run` with `runId`).
 *
 * `dryRun: true` answers what the Retry would run and charge — the steps, the
 * price, whether the balance and the runner's app credits cover it — and creates nothing. The runner's
 * confirmation reads it before the Retry starts.
 *
 * Refused before anything is written or billed when: the run is not the
 * caller's (404); the app version it ran is gone (409
 * `app_run_version_unavailable`) or is not the one the runner is on (409
 * `app_run_version_changed`): start over; the run is still running (409);
 * it did not fail (a cancelled or completed run, 409 `continuation_not_failed`);
 * nothing is left to run (409); a field the run's inputs set is locked; a
 * Preview render would stop it with nobody to review; the runner cannot pay.
 * A double press is one Retry: the execution is keyed by the run's current one.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { filterCloneNodes } from "@nodaro/shared/workflow"
import { CONTINUATION_SUBSET_REQUIRED, isPreviewHoldingType, withRunOverrides } from "@nodaro/shared/nodes"
import { calculateMonetizationMarkup } from "@nodaro/shared/credits"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isUserBlocked } from "../lib/access-blocks.js"
import { hasCredits } from "../lib/config.js"
import { resolveWebSurfaceFlag } from "../middleware/credit-guard.js"
import { personalPayer, shouldRefuseDegradedRunFor, type BillingContext } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { describeLockedOverrides, findLockedOverrides } from "../lib/input-override-lock.js"
import { exposedVideoLinkNodeIds } from "../lib/exposed-text-caps.js"
import { previewReviewRefusal } from "../lib/preview-review-gate.js"
import { ACTIVE_EXECUTION_STATUSES } from "../lib/request-helpers.js"
import { appReviewerPresent } from "../lib/app-reviewer.js"
import { appRunResumeStamp } from "../lib/app-run-stamp.js"
import { continuationRootOf } from "../lib/continuation-run-root.js"
import { runsInALevel } from "../services/workflow-engine/execution-graph.js"
import { migrateLegacyNodeType } from "../services/workflow-engine/normalize-node-types.js"
import {
  CONTINUATION_REFUSAL_MESSAGE,
  CONTINUATION_REFUSAL_STATUS,
  continuationInputOverrides,
  continuationRefusal,
  continuationRenderStamps,
  continuationSeeds,
  fromFailedClosedRunSet,
  loadContinuationSource,
  type ContinuationSource,
} from "../services/workflow-engine/run-continuation.js"
import { resumeRouteNodeIds, resumeSource } from "../lib/app-run-resume.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

/** The app version the run ran is gone: it cannot be continued; starting over runs the current one. */
export const APP_RUN_VERSION_UNAVAILABLE = "app_run_version_unavailable"
/** The app is on another version than the one the run ran: a Retry would mix them; starting over runs the new one. */
export const APP_RUN_VERSION_CHANGED = "app_run_version_changed"

const params = z.object({ slug: z.string().min(1), runId: z.string().uuid() })
const body = z
  .object({
    /** Answer what the Retry would run and charge; create nothing. */
    dryRun: z.boolean().optional(),
    /** The app runner's mark: a person is there to review a Preview render. */
    reviewer: z.string().max(32).optional(),
    /**
     * The app version the caller expects the Retry to run (what starting over would run: the
     * runner's pick, else the latest). Absent: the app's latest. A run of another version is refused.
     */
    version: z.number().int().positive().optional(),
  })
  .strict()

type SnapshotNode = { id: string; type?: string; data?: Record<string, unknown>; parentId?: string | null }
type SnapshotEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
type VersionRow = {
  id: string
  workflow_id: string
  creator_id: string | null
  publish_type: string | null
  version: number | null
  snapshot_nodes: SnapshotNode[] | null
  snapshot_edges: SnapshotEdge[] | null
  snapshot_settings: Record<string, unknown> | null
  monetization_enabled: boolean | null
  monetization_flat_fee: number | null
  monetization_percent: number | null
}

export async function appRunResumeRoutes(app: FastifyInstance) {
  app.post("/v1/app/:slug/runs/:runId/resume", { preHandler: requireAppScope("workflows:execute") }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsedParams = params.safeParse(req.params)
    const parsedBody = body.safeParse(req.body ?? {})
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid request" } })
    }
    const { slug, runId } = parsedParams.data
    const { dryRun = false, reviewer, version: expectedVersion } = parsedBody.data
    const userId = req.userId

    try {
      // The run: the runner's own, not archived.
      const { data: run, error: runError } = await supabase
        .from("app_runs") // tenant-scope-ignore: scoped by runner_id
        .select("id, app_id, execution_id")
        .eq("id", runId)
        .eq("runner_id", userId)
        .is("deleted_at", null)
        .maybeSingle()
      if (runError) return sendInternalError(reply, req, runError, "Failed to load run")
      if (!run) return reply.status(404).send({ error: { code: "not_found", message: "Run not found" } })
      const runRow = run as { id: string; app_id: string; execution_id: string | null }

      // The app under this slug, and the version the run ran (never the app's latest).
      const { data: slugRow } = await supabase
        .from("published_apps")
        .select("workflow_id")
        .eq("slug", slug)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle()
      if (!slugRow) return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
      const { data: versionData } = await supabase
        // tenant-scope-ignore: a published version, matched to the slug's workflow and the creator's block below
        .from("published_apps")
        .select(
          "id, workflow_id, creator_id, publish_type, version, snapshot_nodes, snapshot_edges, snapshot_settings, monetization_enabled, monetization_flat_fee, monetization_percent",
        )
        .eq("id", runRow.app_id)
        .is("deleted_at", null)
        .maybeSingle()
      const version = versionData as VersionRow | null
      if (!version) {
        return reply.status(409).send({
          error: {
            code: APP_RUN_VERSION_UNAVAILABLE,
            message: "The app version this run used is no longer available, so it cannot be continued. Start over to run the app's current version.",
          },
        })
      }
      if (version.workflow_id !== (slugRow as { workflow_id: string }).workflow_id || (await isUserBlocked(version.creator_id ?? null))) {
        return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
      }
      // The version a Retry continues is the run's own, and only while it is the one the runner is on:
      // a newer version since (or the runner's pick of another) is a version change, refused — starting
      // over runs that one. Continuing on the old snapshot is asked for by naming its version.
      const expected = expectedVersion ?? (await latestVersionOf(version.workflow_id))
      if (expected !== null && version.version !== null && expected !== version.version) {
        return reply.status(409).send({
          error: {
            code: APP_RUN_VERSION_CHANGED,
            message: `This run used version ${version.version} of the app, which is now on version ${expected}, so it cannot be continued. Start over to run version ${expected}.`,
          },
          runVersion: version.version,
          appVersion: expected,
        })
      }
      if (version.publish_type === "component") {
        return reply.status(400).send({ error: { code: "validation_error", message: "A component's run is continued by the run that called it." } })
      }

      const nodes = version.snapshot_nodes ?? []
      const edges = version.snapshot_edges ?? []
      const typeOf = new Map(nodes.map((n) => [n.id, n.type ?? ""]))
      const isRenderNode = (id: string) => isPreviewHoldingType(typeOf.get(id))
      if (!runRow.execution_id) {
        return reply.status(409).send({ error: { code: "continuation_not_failed", message: CONTINUATION_REFUSAL_MESSAGE.continuation_not_failed } })
      }
      const pointed = await loadContinuationSource(runRow.execution_id, { withStates: true, isRenderNode })
      if (pointed && (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(pointed.status)) {
        return reply.status(409).send({
          error: { code: "already_running", message: "This run is still running." },
          executionId: pointed.id,
        })
      }
      // A Retry refused before it started holds nothing: continue what it continued.
      const source: ContinuationSource | null = pointed
        ? await resumeSource(pointed, (id) => loadContinuationSource(id, { withStates: true, isRenderNode }))
        : null

      // Every node of the run (an expanded loop clone is none), narrowed to the route the app runs.
      const graphOrder = filterCloneNodes(
        nodes.map((n) => ({ ...n, type: n.type ?? "", data: n.data ?? {} })),
        [] as Array<{ source: string; target: string }>,
      ).nodes.map((n) => n.id)
      const considered = resumeRouteNodeIds(graphOrder, nodes, edges, version.snapshot_settings)
      const refusal = continuationRefusal(source, {
        userId,
        workflowId: version.workflow_id,
        appVersionId: version.id,
        nodeIds: considered,
        mode: "from-failed",
      })
      if (refusal || !source) {
        const code = refusal ?? "continuation_not_found"
        return reply.status(CONTINUATION_REFUSAL_STATUS[code]).send({ error: { code, message: CONTINUATION_REFUSAL_MESSAGE[code] } })
      }

      // What the failed run did not complete, closed over what it needs upstream.
      const runSet = fromFailedClosedRunSet(graphOrder, considered, { nodes, edges }, source)
      const currentTypeOf = new Map(nodes.map((n) => [n.id, migrateLegacyNodeType(n).type ?? ""]))
      const steps = runSet.filter((id) => runsInALevel(currentTypeOf.get(id) ?? ""))
      if (steps.length === 0) {
        return reply.status(409).send({
          error: { code: CONTINUATION_SUBSET_REQUIRED, message: "Every step of this run completed: there is nothing left to retry." },
        })
      }

      // The inputs the run applied (its pin): a Retry sends none of its own.
      const effective = continuationInputOverrides(source, undefined)
      const locked = findLockedOverrides(nodes, effective, exposedVideoLinkNodeIds(version.snapshot_settings, nodes))
      if (locked.length > 0) {
        return reply.status(400).send({ error: { code: "locked_field", message: describeLockedOverrides(locked) } })
      }
      const reviewerPresent = appReviewerPresent(req, { mark: reviewer })
      if (!reviewerPresent) {
        const runIds = new Set(runSet)
        const stop = previewReviewRefusal(nodes, edges, {
          triggerType: "app_run",
          nodeIds: runSet,
          inputOverrides: effective,
          savedRenders: (graph) => continuationRenderStamps(graph, continuationSeeds(graph, source, runIds, undefined)),
        })
        if (stop) return reply.status(400).send({ error: stop })
      }

      const billingContext = req.billingContext ?? personalPayer(userId)
      const webFreeMode = await resolveWebSurfaceFlag(req)
      const price = hasCredits()
        ? await resumePrice({ userId, billingContext, webFreeMode, version, nodes, edges, runSet, source, effective })
        : null
      const stepList = steps.map((id) => {
        const node = nodes.find((n) => n.id === id)
        const label = typeof node?.data?.label === "string" && node.data.label.trim() ? node.data.label.trim() : null
        return { nodeId: id, type: currentTypeOf.get(id) ?? "", label }
      })
      if (dryRun) {
        // The app-credit allowance the real call checks (read only: it writes nothing), so the
        // quote never says "covered" for a runner the Retry would refuse for want of app credits.
        const eligibility = hasCredits()
          ? await (await import("../ee/billing/credits.js")).CreditsService.checkAppRunEligibility(userId)
          : { allowed: true as const, appCreditsAllowance: undefined }
        return reply.send({
          data: {
            runId,
            continuesExecutionId: source.id,
            appVersion: version.version,
            nodeIds: runSet,
            steps: stepList,
            estimatedCredits: price?.estimatedCredits ?? null,
            reusedClips: price?.reusedClips ?? 0,
            sufficient: price ? price.sufficient && eligibility.allowed : null,
            available: price?.available ?? null,
            // Present only when the app credits are what stops it.
            ...(eligibility.allowed ? {} : { appCreditsAllowance: eligibility.appCreditsAllowance ?? 0 }),
          },
        })
      }

      // The payer and the app allowance, as an app run's.
      if (req.billingContext && (await shouldRefuseDegradedRunFor(req.billingContext, version.workflow_id))) {
        return reply.status(503).send({
          error: { code: "billing_unavailable", message: "Billing is temporarily unavailable for workspace runs. Try again shortly." },
        })
      }
      if (hasCredits()) {
        const { CreditsService } = await import("../ee/billing/credits.js")
        const eligibility = await CreditsService.checkAppRunEligibility(userId)
        if (!eligibility.allowed) {
          return reply.status(402).send({
            error: { code: "insufficient_app_credits", message: eligibility.error, appCreditsAllowance: eligibility.appCreditsAllowance },
          })
        }
        if (price && price.sufficient === false) {
          return reply.status(402).send({
            error: { code: "insufficient_credits", message: price.message ?? `This retry can hold up to about ${price.holdCredits} credits; your balance is ${price.available ?? 0}.` },
          })
        }
      }

      // One Retry per execution the run points at: a double press is the same Retry.
      const { row: execution, created } = await insertWithIdempotencyKey<{ id: string }>(
        "workflow_executions",
        {
          workflow_id: version.workflow_id,
          user_id: userId,
          status: "pending",
          trigger_type: "app_run",
          trigger_data: appRunResumeStamp(runId, source.id),
          ...billingPairColumns(billingContext),
        },
        `app-run-resume:${runRow.execution_id}`,
        "id",
      )
      if (!created) {
        reply.header("X-Dedup-Hit", "1")
        return reply.status(200).send({ executionId: execution.id, runId, status: "pending", nodeIds: runSet, deduped: true })
      }
      const { data: moved, error: moveError } = await supabase
        .from("app_runs") // tenant-scope-ignore: scoped by runner_id
        .update({ execution_id: execution.id, status: "running" })
        .eq("id", runId)
        .eq("runner_id", userId)
        .eq("execution_id", runRow.execution_id)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle()
      if (moveError || !moved) {
        // The run moved on meanwhile (another tab's run): this Retry never starts.
        await supabase.from("workflow_executions").update({ status: "cancelled", error_message: "superseded" }).eq("id", execution.id).eq("user_id", userId)
        return reply.status(409).send({ error: { code: "already_running", message: "This run was started again elsewhere." } })
      }

      const jobData: WorkflowExecutionJob = {
        executionId: execution.id,
        workflowId: version.workflow_id,
        userId,
        triggerType: "app_run",
        appVersionId: version.id,
        nodeIds: runSet,
        continueFromExecutionId: source.id,
        continueMode: "from-failed",
        appRunResume: true,
        webFreeMode,
        billingContext,
        reviewerPresent,
      }
      await orchestrationQueue.add("workflow-execution", jobData, { jobId: execution.id })
      return reply.status(202).send({ executionId: execution.id, runId, status: "pending", nodeIds: runSet })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to retry the run")
    }
  })
}

/** The app's latest published version number (the one a run without a pick runs), or null when none reads. */
async function latestVersionOf(workflowId: string): Promise<number | null> {
  const { data } = await supabase
    .from("published_apps")
    .select("version")
    .eq("workflow_id", workflowId)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  const n = (data as { version?: unknown } | null)?.version
  return typeof n === "number" ? n : null
}

/**
 * What the Retry charges: the steps it runs (a UGC Clip only for the clips it renders), plus the
 * creator's markup as the run settles it, and whether the payer can hold it while its clips render.
 */
async function resumePrice(input: {
  readonly userId: string
  readonly billingContext: BillingContext
  readonly webFreeMode: boolean
  readonly version: VersionRow
  readonly nodes: readonly SnapshotNode[]
  readonly edges: readonly SnapshotEdge[]
  readonly runSet: readonly string[]
  readonly source: ContinuationSource
  readonly effective: Record<string, Record<string, unknown>> | undefined
}): Promise<{ estimatedCredits: number; holdCredits: number; reusedClips: number; sufficient: boolean; available: number | null; message?: string }> {
  // Credits are enterprise: loaded only where the edition has them.
  const { appRunResumeCredits } = await import("../ee/lib/app-run-resume-price.js")
  const { UgcEstimateUnavailable } = await import("../ee/lib/ugc-estimate.js")
  const { checkRunSetCredits, estimateRunSetCredits } = await import("../ee/billing/credits.js")
  const priced = withRunOverrides(input.nodes as Array<SnapshotNode & { type?: string }>, input.effective) as Array<{ id: string; type: string; data?: Record<string, unknown> }>
  const runNodeIds = new Set(input.runSet)
  let base: { credits: number; hold: number; reusedClips: number }
  try {
    base = await appRunResumeCredits({
      caller: { userId: input.userId, billingContext: input.billingContext },
      nodes: priced,
      edges: input.edges,
      runNodeIds,
      sourceStates: (input.source.nodeStates ?? {}) as Parameters<typeof appRunResumeCredits>[0]["sourceStates"],
      runKey: continuationRootOf(input.source),
    })
  } catch (err) {
    // No UGC pricing on this deployment: the run set as every estimate prices it.
    if (!(err instanceof UgcEstimateUnavailable)) throw err
    const credits = await estimateRunSetCredits(priced, input.edges, runNodeIds)
    base = { credits, hold: credits, reusedClips: 0 }
  }
  // The creator's markup, settled by the run once on what it runs (never from the runner who made the app).
  const v = input.version
  const markup =
    v.monetization_enabled && v.creator_id !== input.userId
      ? calculateMonetizationMarkup(base.credits, v.monetization_flat_fee ?? 0, v.monetization_percent ?? 0)
      : 0
  const holdCredits = base.hold + markup
  const check = await checkRunSetCredits(input.userId, holdCredits, { billingContext: input.billingContext, webFreeMode: input.webFreeMode })
  return {
    estimatedCredits: base.credits + markup,
    holdCredits,
    reusedClips: base.reusedClips,
    sufficient: check.sufficient,
    available: check.available,
    ...(check.message !== undefined ? { message: check.message } : {}),
  }
}
