import { supabase } from "./supabase.js"
import { deleteFromR2, r2KeyFromOurUrl } from "./storage.js"
import { isRelayedJob, relayOwnedKeys } from "./asset-delete.js"
import { isOwnedObjectKey } from "./job-policy-outputs.js"
import { relayPossible } from "./relay-possible.js"

interface WorkflowDeleteLogger {
  warn(fields: Record<string, unknown>, message: string): void
}

interface DeleteWorkflowResult {
  deleted: boolean
  baseUrls: string[]
}

type DeleteScope =
  | { workflowId: string }
  | { projectId: string }
  | { jobId: string }

function parseDeleteResult(value: unknown): DeleteWorkflowResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.deleted !== "boolean" || !Array.isArray(row.baseUrls)) return null
  if (!row.baseUrls.every((url) => typeof url === "string" && url.length > 0)) return null
  return { deleted: row.deleted, baseUrls: row.baseUrls as string[] }
}

/**
 * Atomically delete an owner-scoped workflow while retaining the server-only
 * R2 cleanup manifest that its cascading job delete would otherwise erase.
 * The private URLs never leave this backend helper or enter owner-readable
 * jobs JSON. R2 deletion is deliberately best-effort after the durable delete:
 * a storage outage must not resurrect a workflow the user already destroyed.
 */
async function deleteWithPrivateMedia(args: {
  rpcName:
    | "delete_workflow_with_recast_cleanup"
    | "delete_project_with_recast_cleanup"
    | "delete_job_with_recast_cleanup"
  rpcArgs: Record<string, string | boolean>
  scope: DeleteScope
  resourceLabel: "workflow" | "project" | "job"
  logger?: WorkflowDeleteLogger
}): Promise<boolean> {
  // RELAY RULE (spec 2026-09-04-sai-local-development §9.3, D18): an object our
  // relay target created is never deleted here. Read BEFORE the RPC, because
  // the RPC cascades the `jobs` rows away and `relay_job_id` is unreadable
  // after it returns — the base urls arrive only in its response.
  //
  // TWO markers, because they answer at different times and cover different
  // scopes.
  //
  // (1) The JOB ROW, read HERE — before the RPC, which cascades the `jobs` rows
  //     away and makes `relay_job_id` unreadable afterwards. Only the JOB scope
  //     can be asked this with the ids we hold: a base url belongs to a GVP job
  //     somewhere inside the deleted subtree, and PostgREST cannot express "the
  //     relayed jobs under this workflow / project / recursive parent chain" in
  //     one call.
  //
  // (2) The DURABLE PER-OBJECT marker (`assets.relay_job_id`, migration 384),
  //     applied to the harvested keys below. It is keyed on the OBJECT rather
  //     than on a job row the RPC just deleted, so it answers for ALL THREE
  //     scopes and survives the cascade — which is what closes the scope hole
  //     (1) could only document. `assets.job_id` is ON DELETE SET NULL, so the
  //     asset row and its marker both outlive the job.
  //
  // Neither costs anything today on a mainline deployment: a `recast_audio_bases`
  // row is written by the GVP finalizer and by Recast's fork, both of which
  // upload a LOCALLY stitched, pre-watermark remux under this instance's own
  // key — and no GVP or recast job type has a relay lane at all
  // (`CLOUD_ROUTE_BY_JOB_TYPE` in providers/nodaro/run-on-cloud.ts, and the
  // capability router serves image/video/audio only), so a private audio base
  // is never a far-end object.
  //
  // THE ARMING GATE (lib/relay-possible.ts) sits in front of both. Without it
  // marker (1) is a `jobs` round trip on EVERY job delete on every deployment,
  // paid ahead of the durable delete for an answer that can only ever be NULL
  // where nothing relays — the one thing this change promised not to do.
  const relayScopedJobId = "jobId" in args.scope ? args.scope.jobId : null
  const scopeJobWasRelayed =
    relayPossible() && relayScopedJobId ? await isRelayedJob(relayScopedJobId) : false

  const { data, error } = await supabase.rpc(args.rpcName, args.rpcArgs)
  if (error) throw new Error(`Failed to delete ${args.resourceLabel}: ${error.message}`)

  const result = parseDeleteResult(data)
  if (!result) throw new Error(`Malformed ${args.resourceLabel} delete response`)
  if (!result.deleted) return false

  const keys = new Set<string>()
  let skipped = 0
  for (const privateUrl of result.baseUrls) {
    const key = r2KeyFromOurUrl(privateUrl)
    if (key) keys.add(key)
    else skipped += 1
  }

  // Byte-inert without a relay: the predicate returns false before any query
  // for a key in this job's own family, and `relay_job_id` is NULL on every row
  // a non-relaying instance can produce.
  if (scopeJobWasRelayed && relayScopedJobId) {
    for (const key of [...keys]) {
      // A key in the job's OWN family is ours even on a relayed job: a
      // relaying instance without a shared bucket copied those bytes itself.
      if (isOwnedObjectKey(relayScopedJobId, key)) continue
      keys.delete(key)
      args.logger?.warn(
        { ...args.scope, kept: 1 },
        "private base kept: created by our relay target, not by this instance",
      )
    }
  }

  // Marker (2), plus the key-stem fence behind it (lib/asset-delete.ts): two
  // queries, all three scopes, and the same arming gate — a deployment with no
  // relay target issues neither, so the post-RPC cleanup keeps the exact shape
  // it had before this rule existed.
  for (const key of relayPossible() ? await relayOwnedKeys([...keys]) : []) {
    keys.delete(key)
    args.logger?.warn(
      { ...args.scope, kept: 1 },
      "private base kept: the asset row records our relay target as its author",
    )
  }

  const outcomes = await Promise.allSettled(
    [...keys].map((key) => deleteFromR2(key)),
  )
  const failed = outcomes.filter((outcome) => outcome.status === "rejected").length
  if (failed > 0 || skipped > 0) {
    args.logger?.warn(
      { ...args.scope, attempted: keys.size, failed, skipped },
      "private Recast audio-base cleanup incomplete",
    )
  }

  return true
}

export function deleteWorkflowWithPrivateMedia(args: {
  workflowId: string
  userId: string
  logger?: WorkflowDeleteLogger
}): Promise<boolean> {
  return deleteWithPrivateMedia({
    rpcName: "delete_workflow_with_recast_cleanup",
    rpcArgs: {
      p_workflow_id: args.workflowId,
      p_user_id: args.userId,
    },
    scope: { workflowId: args.workflowId },
    resourceLabel: "workflow",
    logger: args.logger,
  })
}

export function deleteProjectWithPrivateMedia(args: {
  projectId: string
  userId: string
  logger?: WorkflowDeleteLogger
}): Promise<boolean> {
  return deleteWithPrivateMedia({
    rpcName: "delete_project_with_recast_cleanup",
    rpcArgs: {
      p_project_id: args.projectId,
      p_user_id: args.userId,
    },
    scope: { projectId: args.projectId },
    resourceLabel: "project",
    logger: args.logger,
  })
}

export function deleteJobWithPrivateMedia(args: {
  jobId: string
  actorUserId: string
  isAdmin: boolean
  logger?: WorkflowDeleteLogger
}): Promise<boolean> {
  return deleteWithPrivateMedia({
    rpcName: "delete_job_with_recast_cleanup",
    rpcArgs: {
      p_job_id: args.jobId,
      p_actor_user_id: args.actorUserId,
      p_is_admin: args.isAdmin,
    },
    scope: { jobId: args.jobId },
    resourceLabel: "job",
    logger: args.logger,
  })
}
