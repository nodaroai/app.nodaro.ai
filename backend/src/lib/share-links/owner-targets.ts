/**
 * What an owner may share: their own job, session or project, and why one may
 * not be shared yet. Every read scopes to the owner, so another person's id
 * reads exactly as one that does not exist (404, never a hint that it does).
 */
import { supabase } from "../supabase.js"
import { surfaceAllowsPublicOutputs } from "../surface-profile.js"
import { findOwnerJob, findOwnerJobAnyState, jobShareRefusal } from "./job-reads.js"
import type { ShareJobRow } from "./shared-job.js"
import type { ShareKind, ShareRefusal } from "./types.js"

export type OwnTarget =
  | { readonly kind: "job"; readonly job: ShareJobRow }
  | { readonly kind: "session" | "project"; readonly workspaceId: string | null }

async function ownRow(table: "generation_sessions" | "projects", ownerId: string, id: string): Promise<{ workspace_id: string | null } | null> {
  const { data, error } = await supabase.from(table).select("id, workspace_id").eq("id", id).eq("user_id", ownerId).maybeSingle()
  if (error) throw new Error(`${table} read failed: ${error.message}`)
  return (data as { workspace_id: string | null } | null) ?? null
}

/**
 * The caller's own item, or null (not theirs, deleted, or a child job). A job
 * in the Trash is found only `withTrashed`: to read its link and turn it off,
 * never to turn one on.
 */
export async function findOwnTarget(
  ownerId: string,
  kind: ShareKind,
  targetId: string,
  opts: { readonly withTrashed?: boolean } = {},
): Promise<OwnTarget | null> {
  if (kind === "job") {
    const job = opts.withTrashed ? await findOwnerJobAnyState(ownerId, targetId) : await findOwnerJob(ownerId, targetId)
    return job ? { kind, job } : null
  }
  const row = await ownRow(kind === "session" ? "generation_sessions" : "projects", ownerId, targetId)
  return row ? { kind, workspaceId: row.workspace_id ?? null } : null
}

/**
 * Why this item may not be shared now, or null. Asked when a link is turned
 * on; the public read asks the same of what it shows, so an item that changes
 * after it was shared (restricted, moved into a workspace) stops showing.
 */
export function targetShareRefusal(target: OwnTarget): ShareRefusal | null {
  // A deployment that does not allow public work has no public links (lib/surface-profile.ts).
  if (!surfaceAllowsPublicOutputs()) return "sharing_disabled"
  if (target.kind === "job") return jobShareRefusal(target.job)
  // Work done in a workspace is never public (migration 337), so neither is its list.
  return target.workspaceId ? "workspace" : null
}
