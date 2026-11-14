// @registry-enumerates prices the run by estimateWorkflowCreditsDetailed over whatever node types the workflow holds
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { isUserBlocked } from "../lib/access-blocks.js"
import { resolveWebSurfaceFlag } from "../middleware/credit-guard.js"
import { insertJob, insertJobIdempotent } from "../lib/insert-job.js"
import { MIN_IDEMPOTENCY_KEY_LENGTH } from "../lib/dedup-fingerprint.js"
import { executeAppRun, type ExecuteAppRunResult } from "../services/app-execution.js"
import { UnqueuedRunError } from "../lib/enqueue-execution.js"
import { markJobFailedDetailed } from "../lib/job-failure.js"
import { parentExecutionIdOf } from "../lib/concurrency-lanes/parent-execution.js"
import { importViaOf } from "../lib/import-via.js"
import type { ComponentMetadata } from "@nodaro/shared/apps"
import { collectComponentOutputs } from "./_collect-component-outputs.js"
import { JOB_POLL_INTERVAL_MS, POLL_ABSOLUTE_TIMEOUT_MS } from "../services/workflow-engine/types.js"
import { BudgetedDeadline, executionBudgetExcessMs, executionMayDispatchBudgetedJob } from "../lib/execution-budget.js"
import { executionQueuedMs } from "../lib/concurrency-lanes/execution-wait.js"
import { estimateWorkflowCreditsDetailed, type EstimateEdge, type EstimateNode } from "../ee/billing/credits.js"
import { existingDraftsFor } from "../ee/billing/existing-drafts-option.js"
import { refuseIfRunUnpriced, replyIfLlmUnpriced } from "../lib/llm-unpriced-refusal.js"
import { usecaseViewerEstimateFor } from "../lib/use-case/inner-availability.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isBillingContext, shouldRefuseDegradedRunFor, type BillingContext } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { describeLockedOverrides, findLockedOverrides } from "../lib/input-override-lock.js"
import { findUnitFieldOverrideRefusals, unitFieldOverrideErrorBody } from "../lib/exposed-unit-field-check.js"
import { exposedVideoLinkNodeIds } from "../lib/exposed-text-caps.js"
import { UGC_APP_PHOTO_REQUIRED, ugcRunMissesPhoto } from "../lib/ugc-app-run.js"
import { cloneRunRefusal } from "../lib/clone-app-run.js"
import { requireScope } from "../lib/scopes.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { completedJobColumns } from "../lib/job-status.js"
import { TRASHED_JOB_COLUMN } from "../lib/public-job-data.js"
import { componentWithheld } from "../lib/published-app-access.js"


const bodySchema = z.object({
  appSlug: z.string().min(1),
  inputOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  pinnedVersion: z.number().int().min(0).optional(),
  workflowId: z.string().uuid().optional(),
  componentDepth: z.number().int().min(0).max(5).optional(),
  executingComponentIds: z.array(z.string()).optional(),
  /** The parent execution's answer to "does the preview stop rule apply?",
   *  forwarded by the orchestrator's component dispatch. Honored ONLY on the
   *  internal lane: from any other caller it would switch the gate off. */
  previewStopRule: z.boolean().optional(),
  /** The parent execution's "cheap lanes only" (a scheduled run under a retry
   *  policy), forwarded by the orchestrator's component dispatch. Honored ONLY
   *  on the internal lane; it only ever reduces spend, but only the
   *  orchestrator sets it. */
  cheapLanesOnly: z.boolean().optional(),
  /** P14 — the parent execution's resolved payer, forwarded by the
   *  orchestrator's component dispatch. Honored ONLY on the internal lane
   *  (see below); shape-guarded, never trusted from the type alone. */
  billingContext: z.unknown().optional(),
})

/**
 * What a component's wrapper job says (`jobs.error_message`) when its inner run
 * could not be started: created or queued. Fixed text — the cause is logged.
 */
export const COMPONENT_RUN_NOT_STARTED_MESSAGE = "The component's run could not be started. Run it again."

async function updateWrapperJob(jobId: string, fields: Record<string, unknown>) {
  // The wrapper settles here, never in a worker, so it carries the completion
  // bookkeeping itself (progress 100 on success; completed_at either way).
  const stamp = fields.status === "completed" ? completedJobColumns() : { completed_at: new Date().toISOString() }
  await supabase.from("jobs").update({ ...fields, ...stamp }).eq("id", jobId)
}

/**
 * Fail a wrapper whose inner run could not be started: the fixed message and
 * `extra` in one write (lib/job-failure.ts), from `processing` (the status the
 * route inserts it in) only, so a wrapper its owner cancelled meanwhile keeps
 * its cancel. Never throws: a write that fails leaves the wrapper to the
 * stuck-wrapper sweep.
 */
async function failUnstartedWrapper(jobId: string, extra: Record<string, unknown>, req: FastifyRequest): Promise<void> {
  try {
    const outcome = await markJobFailedDetailed(jobId, { error_message: COMPONENT_RUN_NOT_STARTED_MESSAGE, from: ["processing"], extra })
    if (outcome === "error") req.log.error({ jobId }, "could not fail a component wrapper whose inner run did not start")
  } catch (err) {
    req.log.error({ err, jobId }, "could not fail a component wrapper whose inner run did not start")
  }
}

export async function componentExecuteRoutes(app: FastifyInstance) {
  app.post("/v1/component/execute", { preHandler: requireAppScope("workflows:execute") }, async (req: FastifyRequest, reply: FastifyReply) => {
    // Spend-surface threading (D1 v2): stamped on the request so the
    // reserve path applies pool-aware payg semantics.
    req.webFreeMode = await resolveWebSurfaceFlag(req)
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }

    const { appSlug, inputOverrides, pinnedVersion, workflowId, componentDepth, executingComponentIds } = parsed.data

    // P14: which payer does the inner execution ride?
    // - INTERNAL lane (the orchestrator's component dispatch): the body
    //   carries the PARENT execution's resolved context verbatim — a header
    //   would be re-resolved mid-run, and the parent already decided. The
    //   value is shape-guarded; a malformed one degrades to this route's own
    //   context, never to a trusted cast.
    // - Any other caller (this route also serves authenticated users): the
    //   body field is IGNORED — accepting it would let any JWT caller forge
    //   a workspace payer. Their payer is the one the billing hook resolved
    //   for this request.
    const forwardedCtx: BillingContext | undefined =
      req.authKind === "internal" &&
      isBillingContext(parsed.data.billingContext) &&
      // Defense in depth: the forwarded context must belong to the request's
      // own user (the internal secret already grants a lot, but a mismatched
      // pair should never ride into a reservation; the RPC's membership
      // guards are the hard backstop either way).
      parsed.data.billingContext.userId === req.userId
        ? parsed.data.billingContext
        : undefined
    const runBillingContext = forwardedCtx ?? req.billingContext
    // The parent's preview stop rule answer: internal lane only (a JWT / MCP
    // caller sending `false` would switch the gate off for its own run).
    const forwardedPreviewStopRule =
      req.authKind === "internal" ? parsed.data.previewStopRule : undefined
    const forwardedCheapLanesOnly = req.authKind === "internal" && parsed.data.cheapLanesOnly === true

    // Look up published app by slug. snapshot_nodes + snapshot_edges are
    // needed for compound output handles (sub-workflow-output ports) — they
    // get resolved by tracing the snapshot edge into the port and reading the
    // upstream node's output from nodeStates.
    let appQuery = supabase
      .from("published_apps")
      .select("id, workflow_id, creator_id, name, component_metadata, estimated_credits, snapshot_nodes, snapshot_edges, snapshot_settings")
      .eq("slug", appSlug)
      .eq("publish_type", "component")
      .eq("is_active", true)
      .is("deleted_at", null)

    if (pinnedVersion) {
      appQuery = appQuery.eq("version", pinnedVersion)
    } else {
      appQuery = appQuery.order("version", { ascending: false }).limit(1)
    }

    const { data: appRows } = await appQuery
    const appRow = appRows?.[0]
    // A blocked author's component answers like a missing one (lib/access-blocks.ts).
    // So does someone else's, on a deployment that does not allow public work,
    // unless a full run of a workflow holding the component node calls it (the
    // orchestrator's lane: lib/published-app-access.ts) — a component placed in
    // a workflow keeps running there, and is not reached by its name.
    if (!appRow || componentWithheld(req, appRow.creator_id) || (await isUserBlocked((appRow.creator_id as string | null) ?? null))) {
      return reply.status(404).send({ error: { code: "not_found", message: "Component not found" } })
    }

    const componentMetadata = appRow.component_metadata as ComponentMetadata | null
    if (!componentMetadata) {
      return reply.status(400).send({ error: { code: "invalid_component", message: "Component metadata missing" } })
    }

    // The caller's override map runs the component author's snapshot; it may
    // not re-point an outbound node inside it (issue #1555). Refused before
    // the wrapper job exists; the orchestrator's merge refuses too.
    const lockedOverrides = findLockedOverrides(
      (appRow.snapshot_nodes as ReadonlyArray<{ id: string; type?: string }> | null) ?? [],
      inputOverrides,
      exposedVideoLinkNodeIds(
        appRow.snapshot_settings as Record<string, unknown> | null,
        appRow.snapshot_nodes as ReadonlyArray<{ id?: string; type?: string }> | null,
      ),
    )
    if (lockedOverrides.length > 0) {
      return reply.status(400).send({
        error: { code: "locked_field", message: describeLockedOverrides(lockedOverrides) },
      })
    }
    // A node unit's app fields (unit.json appFields) take only the values they declare, on any key this
    // request sets, exposed or not (lib/exposed-unit-field-check.ts); the orchestrator's merge refuses too.
    const unitRefusals = findUnitFieldOverrideRefusals((appRow.snapshot_nodes as ReadonlyArray<{ id: string; type?: string }> | null) ?? [], inputOverrides)
    if (unitRefusals.length > 0) return reply.status(400).send({ error: unitFieldOverrideErrorBody(unitRefusals) })

    // A UGC Creator set to "My photo" that the run gives no photo: publishing stripped the author's
    // own, so the creator would stop the run after the script before it was paid for. Refused before
    // the wrapper job exists, as the app runner refuses it (lib/ugc-app-run.ts). A component always
    // runs its whole graph; on the orchestrator's lane the overrides hold its handles' values. Read
    // over every graph it executes: a creator in a sub-workflow, and a creator whose photo comes
    // from one (the run loads those graphs as published).
    {
      const componentNodes = (appRow.snapshot_nodes ?? []) as ReadonlyArray<{ id: string; type?: string; data?: Record<string, unknown> }>
      if (
        await ugcRunMissesPhoto(
          componentNodes,
          (appRow.snapshot_edges ?? []) as ReadonlyArray<{ source?: string; target?: string; targetHandle?: string | null }>,
          inputOverrides,
          undefined,
          appRow.creator_id as string,
        )
      ) {
        return reply.status(400).send({ error: { ...UGC_APP_PHOTO_REQUIRED } })
      }
      // A one-off voice clone: the caller's own recordings and consent, or refused before the wrapper
      // job exists (lib/clone-app-run.ts; decided 2026-11-13).
      const cloneRefusal = await cloneRunRefusal(
        componentNodes,
        (appRow.snapshot_edges ?? []) as ReadonlyArray<{ source?: string; target?: string; targetHandle?: string | null }>,
        inputOverrides,
        undefined,
        appRow.creator_id as string,
        req.userId!,
      )
      if (cloneRefusal) return reply.status(cloneRefusal.status).send({ error: cloneRefusal.error })
    }

    // A metered LLM call on a model with no price (R51): refused before the wrapper job exists, so no
    // fixed node runs and is charged ahead of the call the run would refuse mid-graph.
    if (await refuseIfRunUnpriced(reply, (appRow.snapshot_nodes ?? []) as ReadonlyArray<{ id: string; type?: string; data?: unknown }>, (appRow.snapshot_edges ?? []) as ReadonlyArray<{ source: string; target: string }>, { overrides: inputOverrides as Record<string, Record<string, unknown>> | undefined })) return reply

    // P14: on the DIRECT lane (no forwarded parent context) a DEGRADED
    // resolve on a workspace-homed underlying workflow refuses BEFORE any
    // row is written — the same rule as /v1/app/:slug/run. The forwarded
    // internal lane skips: the parent's own run-creation surface refused
    // the only refusable state, so the child never sees it.
    if (!forwardedCtx && runBillingContext &&
        (await shouldRefuseDegradedRunFor(runBillingContext, appRow.workflow_id as string))) {
      return reply.status(503).send({
        error: { code: "billing_unavailable", message: "Billing is temporarily unavailable for workspace runs. Try again shortly." },
      })
    }

    // Create wrapper job
    const mcpClient = extractMcpClient(req.body)
    const wrapperInput: Record<string, unknown> = {
      type: "component",
      componentName: appRow.name,
      appSlug,
      inputs: inputOverrides ?? {},
    }
    const wrapperRow = {
        user_id: req.userId,
        provider: "component",
        // No worker picks the wrapper up, so nothing else would stamp its type.
        job_type: wrapperInput.type,
        status: "processing",
        started_at: new Date().toISOString(),
        input_data: wrapperInput,
        ...(workflowId ? { workflow_id: workflowId } : {}),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
        // P14/W7: the HONORED context's pair (the internal lane carries it in
        // the body, where the request-level stamp cannot see it).
        ...billingPairColumns(runBillingContext),
      }
    // The wrapper job is the unit a client retries: with an `idempotency-key`
    // header (≥ 8 chars; the MCP verbs forward the client's token) it goes
    // through the idempotent insert, and a hit answers the existing job and
    // starts no second inner run (audit 2026-09-06, D-2/A-15/B-3).
    const headerKeyRaw = req.headers["idempotency-key"]
    const headerKey = typeof headerKeyRaw === "string" ? headerKeyRaw.trim() : ""
    const idempotencyKey = headerKey.length >= MIN_IDEMPOTENCY_KEY_LENGTH ? headerKey : undefined
    let wrapperJob: { id: string } | null = null
    let jobError: unknown = null
    if (idempotencyKey) {
      try {
        const dedup = await insertJobIdempotent<{ id: string }>(req, wrapperRow, idempotencyKey)
        if (!dedup.created) {
          reply.header("X-Dedup-Hit", "1")
          return reply.status(202).send({ jobId: dedup.row.id, deduped: true })
        }
        wrapperJob = dedup.row
      } catch (err) {
        jobError = err
      }
    } else {
      const inserted = await insertJob(req, wrapperRow)
      wrapperJob = inserted.data as { id: string } | null
      jobError = inserted.error
    }

    if (jobError || !wrapperJob) {
      return sendInternalError(reply, req, jobError, "Failed to create component job")
    }

    // Return immediately — run inner execution in background
    reply.status(202).send({ jobId: wrapperJob.id })

    // Background: execute inner workflow, poll status, update wrapper job.
    // Runs the full published workflow (same as app runner) — no node subset
    // filtering so the execution is identical to Present mode.
    setImmediate(async () => {
      let result: ExecuteAppRunResult
      try {
        result = await executeAppRun({
          appVersionId: appRow.id,
          workflowId: appRow.workflow_id as string,
          userId: req.userId!,
          appId: appRow.id as string,
          inputOverrides,
          isComponentExecution: true,
          // A component node of a running run started it (internal lane only): no run slot of its own.
          parentExecutionId: parentExecutionIdOf(req),
          componentDepth,
          executingComponentIds,
          webFreeMode: req.webFreeMode === true,
          // The way the parent run was started (forwarded on the internal lane): its imports of links are held to the same authorization.
          ...(importViaOf(req) ? { importVia: importViaOf(req)! } : {}),
          billingContext: runBillingContext,
          ...(forwardedPreviewStopRule !== undefined ? { previewStopRule: forwardedPreviewStopRule } : {}),
          ...(forwardedCheapLanesOnly ? { cheapLanesOnly: true } : {}),
        })
      } catch (err) {
        // The inner run could not be created or queued. The wrapper is failed
        // with a fixed message (the cause stays in the log, never in the job),
        // from `processing` only, so a wrapper its owner cancelled meanwhile
        // keeps its cancel. Whether its Idempotency-Key goes with it depends
        // on whether anything may be running:
        //   - nothing was queued (a row could not be created), or the queue
        //     refused the run and executeAppRun failed it from `pending`
        //     ("failed"): nothing runs, so the key is released in the same
        //     write and a retry with the same key starts a new run;
        //   - the queue refused the run and its state is unknown
        //     ("unsettled"): it may be waiting or running. The key stays, so
        //     a same-key retry never starts a second run beside it, and the
        //     inner run is stamped on the wrapper as a started one is.
        req.log.error({ err, jobId: wrapperJob.id }, "a component's inner run could not be started")
        await failUnstartedWrapper(
          wrapperJob.id,
          err instanceof UnqueuedRunError && err.outcome === "unsettled"
            ? { input_data: { ...wrapperInput, _executionId: err.executionId } }
            : { idempotency_key: null },
          req,
        )
        return
      }

      // From here on the inner run exists and may be running: a failure below
      // keeps the wrapper's key, so a same-key retry never starts a second run
      // beside it.
      try {
        // Stamp the nested execution id on the wrapper IMMEDIATELY (it was
        // otherwise only written on terminal completion below). If this server
        // process dies mid-poll, the wrapper is left "processing" forever — the
        // reconcile sweep (sweepStuckComponentWrappers) needs `_executionId` to
        // find the nested execution and propagate its terminal status, instead of
        // stranding the parent.
        await supabase
          .from("jobs")
          .update({ input_data: { ...wrapperInput, _executionId: result.executionId } })
          .eq("id", wrapperJob.id)

        // The wait is POLL_ABSOLUTE_TIMEOUT_MS plus the inner execution's
        // budget excess (podcast Track 0.11) — the inner run's own cap grows by
        // the excess of any long render it dispatches, so this wait must too.
        // Looked up only once the base is spent: a component with nothing
        // budgeted inside times out exactly as before. It grows the same lazy
        // way by the time the inner run waited for concurrency slots — for its
        // own run slot (a run started here by the editor or the API takes
        // one) and for its jobs': queued time never counts (decided 2026-10-30).
        const deadline = new BudgetedDeadline(
          POLL_ABSOLUTE_TIMEOUT_MS,
          () => executionBudgetExcessMs(result.executionId, req.userId!),
          () => executionQueuedMs(result.executionId, req.userId!, { includeOwnWait: true }),
        )
        const startTime = Date.now()
        while (!(await deadline.reached(Date.now() - startTime))) {
          // Poll status + progress counts to propagate progress to wrapper job
          const { data: exec } = await supabase
            .from("workflow_executions")
            .select("status, completed_nodes, total_nodes")
            .eq("id", result.executionId)
            .single()

          if (!exec) break

          // Propagate progress percentage to wrapper job so frontend can display it
          const total = (exec.total_nodes as number) ?? 0
          const completed = (exec.completed_nodes as number) ?? 0
          if (total > 0) {
            const pct = Math.round((completed / total) * 100)
            await supabase.from("jobs").update({ progress: pct }).eq("id", wrapperJob.id)
          }

          if (exec.status === "completed" || exec.status === "failed") {
            // Fetch full data only on terminal status
            const { data: fullExec } = await supabase
              .from("workflow_executions")
              .select("status, node_states, total_credits_used, error_message")
              .eq("id", result.executionId)
              .single()

            if (fullExec?.status === "completed") {
              const nodeStates = (fullExec.node_states ?? {}) as Record<string, { output?: Record<string, unknown> }>
              const snapshotNodes = (appRow.snapshot_nodes ?? []) as Array<{ id: string; type?: string }>
              const snapshotEdges = (appRow.snapshot_edges ?? []) as Array<{
                source: string
                target: string
                sourceHandle?: string | null
                targetHandle?: string | null
              }>
              const outputData = collectComponentOutputs(componentMetadata, nodeStates, snapshotNodes, snapshotEdges)

              await updateWrapperJob(wrapperJob.id, {
                status: "completed",
                output_data: {
                  ...outputData,
                  _executionId: result.executionId,
                  _appRunId: result.appRunId,
                },
                credits_actual: fullExec.total_credits_used ?? 0,
              })
            } else {
              await updateWrapperJob(wrapperJob.id, {
                status: "failed",
                error_message: fullExec?.error_message ?? "Component execution failed",
                output_data: { _executionId: result.executionId, _appRunId: result.appRunId },
              })
            }
            return
          }

          await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS))
        }

        await updateWrapperJob(wrapperJob.id, { status: "failed", error_message: "Component execution timed out" })
      } catch (err) {
        await updateWrapperJob(wrapperJob.id, {
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
      }
    })
  })

  // ── Estimate credits for a component with setting overrides ──
  const estimateSchema = z.object({
    appSlug: z.string().min(1),
    pinnedVersion: z.number().int().min(0).optional(),
    exposedSettings: z.record(z.string(), z.unknown()).optional(),
  })

  app.post("/v1/component/estimate-credits", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = estimateSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "bad_request", message: parsed.error.message } })
    }

    const { appSlug, pinnedVersion, exposedSettings } = parsed.data

    let query = supabase
      .from("published_apps")
      .select("snapshot_nodes, snapshot_edges, component_metadata, creator_id")
      .eq("slug", appSlug)
      .eq("publish_type", "component")
      .eq("is_active", true)
      .is("deleted_at", null)

    if (pinnedVersion && pinnedVersion > 0) {
      query = query.eq("version", pinnedVersion)
    } else {
      query = query.order("version", { ascending: false }).limit(1)
    }

    const { data: app } = await query.single()
    // Someone else's component is not priced by its name on a deployment that
    // does not allow public work: the same rule as its run (componentWithheld).
    if (!app || componentWithheld(req, app.creator_id)) {
      return reply.status(404).send({ error: { code: "not_found", message: "Component not found" } })
    }

    const nodes = (app.snapshot_nodes ?? []) as Array<{ id?: string; type?: string; data?: Record<string, unknown>; parentId?: string | null }>
    const edges = (app.snapshot_edges ?? []) as EstimateEdge[]
    const overrides = exposedSettings ?? {}

    // Each exposed-setting override ("<nodeId>:<field>") lands on its node's
    // data; the workflow estimate then prices the result. The same estimate a
    // published app quotes, at the prices a run is charged — this route used
    // to keep its own sum of base prices, which quoted below the charge.
    const priced: EstimateNode[] = nodes.map((node) => {
      const nodeId = node.id ?? ""
      const data = { ...(node.data ?? {}) } as Record<string, unknown>
      for (const [key, value] of Object.entries(overrides)) {
        const sep = key.indexOf(":")
        if (sep < 0) continue
        if (key.slice(0, sep) === nodeId) data[key.slice(sep + 1)] = value
      }
      return { id: nodeId, type: node.type ?? "", data, parentId: node.parentId }
    })

    // A use-case node is priced on the recordings and framing source the caller's run reads (decided 2026-10-19/20),
    // and a finalize of a Seedance draft the caller already has at its exact price (decided 2026-11-13).
    const viewer = await usecaseViewerEstimateFor(priced, req.userId)
    let estimate: Awaited<ReturnType<typeof estimateWorkflowCreditsDetailed>>
    try {
      estimate = await estimateWorkflowCreditsDetailed(priced, edges, { ...viewer, ...existingDraftsFor(req.userId) })
    } catch (err) {
      // A metered LLM model with no price (R49): refused, as its run would be.
      if (await replyIfLlmUnpriced(reply, err)) return reply
      throw err
    }
    // A metered LLM line makes the figure an estimate (`≈`, spec §8.5); present only then.
    return reply.send({ estimatedCredits: estimate.credits, ...(estimate.estimate ? { estimatedCreditsIsEstimate: true } : {}) })
  })

  // ── How long this component run may take (podcast Track 0.11 follow-up) ──
  // The server waits POLL_ABSOLUTE_TIMEOUT_MS on the inner execution, grown by
  // that execution's budget excess (the long renders it dispatched — the SAME
  // figure the background wait above and the parent DAG's component node read,
  // `executionBudgetExcessMs`). The editor's client-side component executor
  // asks for it once its own 30-minute wait is spent, so a component that
  // renders for hours is not abandoned by the browser while the server keeps
  // it running (decision 2026-09-24: "the editor's component executor waits as
  // long as the server allows"). Read lazily — only then — so a component with
  // nothing budgeted never pays for the lookup more than once. It also says
  // whether the run may still dispatch a long render it has not reached yet
  // (`pendingBudgetedNodes`), so the editor waits the server's base for it.
  const waitLimitParams = z.object({ jobId: z.string().uuid() })

  app.get("/v1/component/execute/:jobId/wait-limit", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const params = waitLimitParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "jobId must be a UUID" } })
    }
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    let query = supabase.from("jobs").select("user_id, provider, input_data").is(TRASHED_JOB_COLUMN, null).eq("id", params.data.jobId)
    if (!isAdmin) query = query.eq("user_id", req.userId)
    const { data: wrapper } = await query.maybeSingle()
    // Only a component WRAPPER has an inner execution; any other job (or one
    // that is not the caller's) is simply not found.
    if (!wrapper || wrapper.provider !== "component") {
      return reply.status(404).send({ error: { code: "not_found", message: "Component run not found" } })
    }
    // `_executionId` sits in job input written before clients lost their
    // jobs writes (474), so it is only a pointer to check: the inner run counts
    // only when the wrapper's owner owns it. Anyone else's execution reads as
    // "no inner run" — its budget is never looked at.
    const stamped = (wrapper.input_data as Record<string, unknown> | null)?._executionId
    let inner: string | null = null
    if (typeof stamped === "string") {
      const { data: innerRow } = await supabase
        .from("workflow_executions")
        .select("id")
        .eq("id", stamped)
        .eq("user_id", wrapper.user_id as string)
        .maybeSingle()
      if (innerRow) inner = stamped
    }
    // `pendingBudgetedNodes`: the run may STILL dispatch a long render (one is
    // in its graph and has not settled). The excess only counts renders
    // already dispatched, so without this a client asking while the run is
    // still in its early steps would read "nothing budgeted" and give up on a
    // run the server keeps waiting on. No inner run stamped → false (a wrapper
    // with no inner run has nothing to wait for).
    // `queuedMs`: how long the run has waited for concurrency slots so far —
    // its own run slot and its jobs' (`executionQueuedMs`). Queued time never
    // counts (decided 2026-10-30), so the server's wait grows by it as the
    // background wait above does.
    const [budgetExcessMs, pendingBudgetedNodes, queuedMs] = inner !== null
      // The readers are owner-scoped too (a second fence behind the lookup
      // above): another user's execution reads as missing.
      ? await Promise.all([
        executionBudgetExcessMs(inner, wrapper.user_id as string),
        executionMayDispatchBudgetedJob(inner, wrapper.user_id as string),
        executionQueuedMs(inner, wrapper.user_id as string, { includeOwnWait: true }),
      ])
      : [0, false, 0]
    return reply.send({
      data: { budgetExcessMs, waitLimitMs: POLL_ABSOLUTE_TIMEOUT_MS + budgetExcessMs + queuedMs, pendingBudgetedNodes, queuedMs },
    })
  })
}
