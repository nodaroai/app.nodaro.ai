import { supabase } from "./supabase.js"
import { deleteFromR2, r2KeyFromOurUrl } from "./storage.js"

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
