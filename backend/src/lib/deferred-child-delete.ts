import { supabase } from "./supabase.js"
import { MAX_CHILD_JOB_DEPTH } from "./public-job-data.js"
import { deferRuleOf, deferredSettlementOf, listOpenDeferredChildren, planDeliveredChildren, resolveDeferredChild, type OpenDeferredChild } from "./deferred-child-settlement.js"

/**
 * A DELETE NEVER STRANDS A HELD STEP. `jobs.parent_job_id` is ON DELETE
 * CASCADE and `usage_logs.job_id` ON DELETE SET NULL: deleting a run deletes
 * its held engine children with it, and their still-`reserved` usage logs lose
 * their job — no sweep could find them again. So every job, workflow and
 * project delete (`deleteWithPrivateMedia`, lib/workflow-delete.ts: the Trash's
 * delete-for-good and its purge, a trend run's delete, a workflow's and a
 * project's delete) first RELEASES every held child in what it deletes:
 * refunded through the atomic refund, recorded as released (one whose settle
 * was decided but had not landed is settled instead, and a `"delivered"` step
 * of a run that COMPLETED is decided as the sweep decides it — charged when the
 * run's completion lists it among the files it delivered, released otherwise:
 * deleting a delivered video never gives its upscale back). Only the open ones
 * are read (migration 693's index), so a delete with nothing held costs one
 * small read.
 *
 * Not covered: an account's own deletion (its jobs go with the user, payer
 * and all) and a job deleted outside `deleteWithPrivateMedia` (the reservation
 * rollbacks that delete a job they just inserted, which has no children).
 */

export type DeleteScopeForRelease =
  | { jobId: string }
  | { workflowId: string; userId: string }
  | { projectId: string; userId: string }

interface Ancestor {
  id: string
  parent_job_id: string | null
  workflow_id: string | null
}

/** Each open child's ancestors (parent first), at most MAX_CHILD_JOB_DEPTH up. */
async function ancestorsOf(children: readonly OpenDeferredChild[]): Promise<Map<string, Ancestor[]> | null> {
  const byId = new Map<string, Ancestor>()
  let frontier = [...new Set(children.flatMap((c) => (c.parent_job_id ? [c.parent_job_id] : [])))]
  for (let depth = 0; depth < MAX_CHILD_JOB_DEPTH && frontier.length > 0; depth++) {
    // trash-read: the runs about to be deleted, Trash included.
    const { data, error } = await supabase.from("jobs").select("id, parent_job_id, workflow_id").in("id", frontier)
    if (error) return null
    for (const row of (data ?? []) as Ancestor[]) byId.set(row.id, row)
    frontier = [...new Set(((data ?? []) as Ancestor[]).flatMap((r) => (r.parent_job_id && !byId.has(r.parent_job_id) ? [r.parent_job_id] : [])))]
  }
  const out = new Map<string, Ancestor[]>()
  for (const c of children) {
    const chain: Ancestor[] = []
    for (let id = c.parent_job_id; id && chain.length < MAX_CHILD_JOB_DEPTH; ) {
      const a = byId.get(id)
      if (!a) break
      chain.push(a)
      id = a.parent_job_id
    }
    out.set(c.id, chain)
  }
  return out
}

async function workflowsOfProject(projectId: string, userId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase.from("workflows").select("id").eq("project_id", projectId).eq("user_id", userId)
  if (error) return null
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}

/** The open held children the delete of `scope` would take with it. */
export async function heldChildrenInScope(scope: DeleteScopeForRelease): Promise<OpenDeferredChild[] | null> {
  const open = await listOpenDeferredChildren()
  if (open === null) return null
  if (open.length === 0) return []
  const chains = await ancestorsOf(open)
  if (chains === null) return null
  if ("jobId" in scope) {
    return open.filter((c) => c.id === scope.jobId || (chains.get(c.id) ?? []).some((a) => a.id === scope.jobId))
  }
  const workflows = "workflowId" in scope ? new Set([scope.workflowId]) : await workflowsOfProject(scope.projectId, scope.userId)
  if (workflows === null) return null
  return open.filter((c) => c.user_id === scope.userId
    && [c.workflow_id, ...(chains.get(c.id) ?? []).map((a) => a.workflow_id)].some((w) => w !== null && workflows.has(w)))
}

/**
 * The settle-or-release of each held `"delivered"` child whose run COMPLETED
 * (`planDeliveredChildren` on the run's output); every other child is absent.
 * Null when the runs could not be read (each such child is then released).
 */
async function deliveredDecisions(children: readonly OpenDeferredChild[]): Promise<Map<string, "settled" | "released"> | null> {
  const out = new Map<string, "settled" | "released">()
  const delivered = children.filter((c) => c.parent_job_id && deferRuleOf(c) === "delivered" && deferredSettlementOf(c.held_completion_fields)?.state === "held")
  if (delivered.length === 0) return out
  // trash-read: the runs about to be deleted, Trash included.
  const { data, error } = await supabase.from("jobs").select("id, status, output_data").in("id", [...new Set(delivered.map((c) => c.parent_job_id!))])
  if (error) return null
  for (const run of (data ?? []) as Array<{ id: string; status: string; output_data: unknown }>) {
    if (run.status !== "completed") continue
    const plan = planDeliveredChildren(run.output_data, delivered.filter((c) => c.parent_job_id === run.id))
    for (const id of plan.settle) out.set(id, "settled")
    for (const id of plan.release) out.set(id, "released")
  }
  return out
}

/**
 * Release every held child the delete of `scope` takes with it, before the
 * delete. Never throws and never blocks the delete: a child whose release did
 * not land is an `[ALERT]` naming it, so its hold can be found by hand.
 */
export async function releaseHeldChildrenBeforeDelete(scope: DeleteScopeForRelease): Promise<void> {
  let children: OpenDeferredChild[] | null
  try {
    children = await heldChildrenInScope(scope)
  } catch (err) {
    children = null
    console.error("[deferred-settlement] reading the held children of a delete failed:", err instanceof Error ? err.message : err)
  }
  if (children === null) {
    console.error(`[ALERT] [deferred-settlement] a delete (${JSON.stringify(scope)}) could not read its held children — any held step it deletes leaves a reserved hold with no job`)
    return
  }
  let byRun: Map<string, "settled" | "released"> | null
  try {
    byRun = await deliveredDecisions(children)
  } catch {
    byRun = null
  }
  if (byRun === null) console.error("[deferred-settlement] a delete could not read the runs of its held steps — each is released")
  for (const child of children) {
    try {
      // A child already decided "settled" (its commit had not landed) is
      // settled now; a delivered step of a completed run as that run decides;
      // every other is released.
      const decided = deferredSettlementOf(child.held_completion_fields)?.state === "settled" ? "settled" : byRun?.get(child.id) ?? "released"
      const outcome = await resolveDeferredChild(child.id, decided, { reason: "its run was deleted", by: "delete" })
      if (outcome === "pending") console.error(`[ALERT] [deferred-settlement] held child ${child.id} could not be released before its delete — its hold stays reserved with no job`)
    } catch (err) {
      console.error(`[ALERT] [deferred-settlement] held child ${child.id} could not be released before its delete:`, err instanceof Error ? err.message : err)
    }
  }
}
