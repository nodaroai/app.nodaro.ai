/**
 * The live use-case wrappers an execution's nodes started (decided
 * 2026-10-13: a wrapper is never stamped with the outer run's
 * `workflow_execution_id`, so job listings never fold it in with that run's
 * jobs). The node's state names it (`jobId`), and that is how an outer run's
 * cancel reaches it. Owner-filtered: a job id in node states is a pointer,
 * not proof. And only the wrappers this execution STARTED — their
 * `idempotency_key` is one it sent (`isExecutionRequestKey`, the engine's own
 * ownership test in use-case-node.ts): a wrapper the node adopted (another
 * request's run it followed — `already_running`, a newer generation) is left
 * running, as the engine's own stop leaves it.
 */
import { supabase } from "../supabase.js"
import { jobIdsOf } from "../node-state-job-ids.js"
import { USE_CASE_WRAPPER_PROVIDER } from "../wrapper-providers.js"
import { IN_FLIGHT_JOB_STATUSES } from "../job-status.js"
import { isExecutionRequestKey } from "../../services/workflow-engine/idempotency-key.js"

/** The owner's in-flight use-case wrappers this execution started that its node states name; [] when there are none or a read fails. */
export async function liveUseCaseWrappersOf(executionId: string, ownerId: string): Promise<string[]> {
  try {
    const { data: exec } = await supabase
      .from("workflow_executions")
      .select("node_states")
      .eq("id", executionId)
      .eq("user_id", ownerId)
      .maybeSingle()
    const ids = jobIdsOf((exec?.node_states as Record<string, unknown> | null | undefined) ?? null)
    if (ids.length === 0) return []
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, idempotency_key")
      .in("id", ids)
      .eq("user_id", ownerId)
      .eq("provider", USE_CASE_WRAPPER_PROVIDER)
      // Still holding its fee and its hidden run (a held one too): what a cancel stops.
      .in("status", [...IN_FLIGHT_JOB_STATUSES])
    return ((jobs ?? []) as Array<{ id?: unknown; idempotency_key?: unknown }>)
      .filter((j) => isExecutionRequestKey(j.idempotency_key, executionId))
      .map((j) => j.id)
      .filter((id): id is string => typeof id === "string")
  } catch {
    return []
  }
}
