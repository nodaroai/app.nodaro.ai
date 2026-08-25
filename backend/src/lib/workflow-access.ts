import { supabase } from "./supabase.js"
import { getPluginServices } from "./private-plugins/load.js"
import type { PluginOrgsService, WorkflowAccessRow } from "./private-plugins/types.js"

/**
 * What a user may do with one workflow.
 *
 * A core seam with no rule of its own. When the organizations plugin is
 * present it decides — it owns the membership tables, the settings
 * inheritance and the collaborator grants, and its answer is the twin of the
 * SQL `workflow_access()` the row policies use. Without it there are no
 * workspaces, no grants and no visibility levers, so the only answer possible
 * is the one this product has always given: the creator owns it, and nobody
 * else has anything.
 *
 * Nothing in a route may re-derive this. There are already two
 * implementations of the rule — TypeScript in the plugin, SQL in the policies
 * — and a parity test exists precisely because two is one too many. A third,
 * written inline in a handler, would be the one nobody remembers to change.
 */

export type AccessLevel = "none" | "view" | "edit" | "own"

/**
 * The four answers come from one plugin or from none of them.
 *
 * Probing each member separately looks safer and is not: creator-only is
 * NOT uniformly weaker than the organization rule. A creator whose
 * membership is suspended, or whose workspace is archived, is refused by the
 * plugin and allowed by the fallback — so a build that supplied
 * `workflowAccess` but not `canDeleteWorkflow` would answer org-aware for
 * reads and creator-only for deletes, and a student suspended from a class
 * would still delete and re-run their work in it, billing the class.
 *
 * The four ship together, but `CLOUD_PLUGINS_VERSION` is a build argument
 * tracked nowhere in git and app-ahead-of-plugin is the normal deployment
 * ordering, so "they always ship together" is not something this file may
 * assume. All four, or the product behaves as if organizations do not exist
 * — which is a state it is designed for and tested in.
 */
type AccessCapableOrgs = {
  workflowAccess: NonNullable<PluginOrgsService["workflowAccess"]>
  workflowAccessFromRow: NonNullable<PluginOrgsService["workflowAccessFromRow"]>
  canDeleteWorkflow: NonNullable<PluginOrgsService["canDeleteWorkflow"]>
  canRunWorkflow: NonNullable<PluginOrgsService["canRunWorkflow"]>
}

function accessCapableOrgs(): AccessCapableOrgs | null {
  const orgs = getPluginServices().orgs
  if (
    !orgs?.workflowAccess ||
    !orgs.workflowAccessFromRow ||
    !orgs.canDeleteWorkflow ||
    !orgs.canRunWorkflow
  ) {
    return null
  }
  return orgs as AccessCapableOrgs
}

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, own: 3 }

export function accessAtLeast(actual: AccessLevel, required: Exclude<AccessLevel, "none">): boolean {
  return RANK[actual] >= RANK[required]
}

/**
 * The fallback, used whenever no plugin supplies the rule.
 *
 * A REAL query, never a constant. Returning `"own"` unconditionally here would
 * turn every community and business install into an open door the moment any
 * route started trusting this seam — which is the entire point of the seam.
 *
 * It is also deliberately byte-equivalent to what the routes do today:
 * `.eq("id", id).eq("user_id", userId).single()` and 404 on a miss produces
 * exactly the same responses as this plus a 404 on `"none"`.
 */
async function creatorOnly(userId: string, workflowId: string): Promise<AccessLevel> {
  const { data, error } = await supabase
    // tenant-scope-ignore: this IS the ownership check — it reads the row's
    // owner in order to answer with it, and filtering by owner would make the
    // answer unconditionally "own" for anyone who got a row back.
    .from("workflows")
    .select("user_id")
    .eq("id", workflowId)
    .maybeSingle()
  if (error || !data) return "none"
  return (data as { user_id: string }).user_id === userId ? "own" : "none"
}

function creatorOnlyFromRow(userId: string, row: WorkflowAccessRow): AccessLevel {
  return row.user_id === userId ? "own" : "none"
}

export async function workflowAccess(userId: string, workflowId: string): Promise<AccessLevel> {
  const orgs = accessCapableOrgs()
  if (!orgs) return creatorOnly(userId, workflowId)
  return orgs.workflowAccess(userId, workflowId)
}

/**
 * The same answer for a caller that already loaded the row.
 *
 * Every by-id route loads the workflow anyway, and `GET /v1/workflows/:id` is
 * a hot path — asking by id there would cost a second round trip on every
 * read. The plugin loads only what the row cannot carry: the workspace facts,
 * the caller's memberships, and the caller's grant.
 */
export async function workflowAccessFromRow(
  userId: string,
  row: WorkflowAccessRow,
): Promise<AccessLevel> {
  const orgs = accessCapableOrgs()
  if (!orgs) return creatorOnlyFromRow(userId, row)
  return orgs.workflowAccessFromRow(userId, row)
}

/**
 * Deleting is its own question, not `accessAtLeast(access, "edit")`.
 *
 * A collaborator holding an editor grant may change a workflow and must never
 * be able to destroy it: the grant was given to help with the work, not to end
 * it. Creator, a workspace admin, or a platform admin — nobody else, whatever
 * their access level says. (A workspace admin qualifies on ROLE; the rule does
 * not consult `admin_access`, which governs what an admin may do WITH the
 * work, not whether they may remove it.)
 */
export async function canDeleteWorkflow(userId: string, workflowId: string): Promise<boolean> {
  const orgs = accessCapableOrgs()
  if (!orgs) return (await creatorOnly(userId, workflowId)) === "own"
  return orgs.canDeleteWorkflow(userId, workflowId)
}

/**
 * Running is stricter than editing, because running spends money.
 *
 * `edit` plus ACTIVE MEMBERSHIP when the workflow belongs to a workspace: a
 * collaborator who was granted edit but does not belong to the class can look
 * and change, and cannot start a job the class pays for.
 */
export async function canRunWorkflow(userId: string, workflowId: string): Promise<boolean> {
  const orgs = accessCapableOrgs()
  if (!orgs) return (await creatorOnly(userId, workflowId)) === "own"
  return orgs.canRunWorkflow(userId, workflowId)
}
