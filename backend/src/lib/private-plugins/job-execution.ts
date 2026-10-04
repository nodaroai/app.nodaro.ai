import { supabase } from "../supabase.js"
import type { PluginJobExecution } from "./types.js"

/**
 * `tk.jobs.readJobExecution` — the workflow run a job belongs to. Nothing
 * comes from the job's payload. What each field is worth:
 *   - `runnerId`, `executionId`, `nodeId`: from the job row, which the host
 *     wrote and no client can update;
 *   - `workflowId` and `workflowOwnerId`: through the run row, whose user may
 *     re-point it (`workflow_executions` carries an owner update policy) — to
 *     a workflow of their OWN, never to another user's without the owner
 *     check failing. So "runner is the workflow's owner" can be claimed by a
 *     runner for their own workflow; it is never a way to act as anyone else.
 *     Bind what matters to the runner (`runnerId`) and to rows the runner owns.
 *
 * Deliberately NOT the run's trigger data: the same owner update policy, and
 * a webhook run's trigger data is the caller's body, so neither may decide
 * who or where a job acts for. A plugin that must know what started a run
 * keeps its own record of the fire, server-side.
 *
 * Scoped like every other job reader: the job is read for the runner the
 * caller already holds (`ctx.jobUserId`), and the owner filter is part of the
 * query — a job of someone else's reads as no run at all.
 *
 * Null for a job outside any run (a direct API call). A read error throws —
 * "no run" must never stand in for "could not tell".
 */

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export async function readJobExecution(jobId: string, scope: { runnerId: string }): Promise<PluginJobExecution | null> {
  if (typeof jobId !== "string" || jobId.trim() === "") throw new Error("readJobExecution: jobId is required")
  const runnerId = scope?.runnerId
  if (typeof runnerId !== "string" || runnerId.trim() === "") throw new Error("readJobExecution: runnerId is required")
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, user_id, workflow_execution_id, input_data")
    .eq("id", jobId)
    .eq("user_id", runnerId)
    .maybeSingle()
  if (jobError) throw new Error(`jobs read failed: ${jobError.message}`)
  if (!job || typeof job.workflow_execution_id !== "string") return null

  const { data: run, error: runError } = await supabase
    .from("workflow_executions")
    .select("id, workflow_id")
    .eq("id", job.workflow_execution_id)
    .maybeSingle()
  if (runError) throw new Error(`workflow_executions read failed: ${runError.message}`)
  if (!run) return null

  const { data: workflow, error: workflowError } = await supabase
    .from("workflows")
    .select("user_id")
    .eq("id", run.workflow_id)
    .maybeSingle()
  if (workflowError) throw new Error(`workflows read failed: ${workflowError.message}`)
  if (!workflow) return null

  const nodeId = objectOrNull(job.input_data)?.node_id
  return {
    jobId: job.id,
    runnerId: job.user_id,
    nodeId: typeof nodeId === "string" ? nodeId : null,
    executionId: job.workflow_execution_id,
    workflowId: run.workflow_id,
    workflowOwnerId: workflow.user_id,
  }
}
