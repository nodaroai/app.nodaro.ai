import { supabase } from "./supabase.js"
import { hasOrganizations } from "./config.js"
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
  canChangeWorkflowVisibility: NonNullable<PluginOrgsService["canChangeWorkflowVisibility"]>
  canShareWorkflow: NonNullable<PluginOrgsService["canShareWorkflow"]>
}

/**
 * ...and only where organizations are actually SWITCHED ON.
 *
 * `hasOrganizations()` and not merely "is a capable plugin loaded", because
 * the two are not the same thing and the difference is visible in production.
 * The plugin gates its ROUTES on the feature flag and builds its SERVICE
 * object unconditionally, so a host running with the flag off still has every
 * member above available to call. Delegating there would change what this
 * product does today: the organization rule answers `own` to a platform admin
 * for every workflow in the database, where these routes answer 404 — and it
 * would pay three reads (the admin check, the memberships, the grant) on the
 * hottest path in the product to reach tables with no rows in them.
 *
 * Gated HERE rather than in each route, because a per-route gate is a thing to
 * remember. Same shape as `orgs-context.ts` and `routes/me.ts`, which is where
 * this rule already lives for the rest of the axis.
 */
function accessCapableOrgs(): AccessCapableOrgs | null {
  if (!hasOrganizations()) return null
  const orgs = getPluginServices().orgs
  if (
    !orgs?.workflowAccess ||
    !orgs.workflowAccessFromRow ||
    !orgs.canDeleteWorkflow ||
    !orgs.canRunWorkflow ||
    !orgs.canChangeWorkflowVisibility ||
    !orgs.canShareWorkflow
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
 *
 * ONE cell is answered here rather than delegated, and it is the only place in
 * this file that departs from "the plugin decides". A personal workflow read
 * by its own creator is `own` under BOTH implementations, unconditionally: the
 * organization rule reaches its creator branch with nothing before it that can
 * fire — a platform admin would already have answered `own`, the fail-closed
 * precondition needs a workspace, and so do suspension and archiving. So the
 * early-out cannot disagree with the plugin; it can only skip the three reads
 * that were always going to conclude the same thing. That case is every
 * install today and the overwhelming majority of reads afterwards, which is
 * why it is worth the one exception. Pinned by test — remove the
 * `workspace_id === null` half and the equivalence proof goes red.
 */
export async function workflowAccessFromRow(
  userId: string,
  row: WorkflowAccessRow,
): Promise<AccessLevel> {
  if (row.workspace_id === null && row.user_id === userId) return "own"
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

/**
 * May this user change WHO ELSE the workflow is visible to?
 *
 * A fourth question, and not `accessAtLeast(access, "edit")`. An editor who
 * could flip a private workflow to `workspace` would be publishing somebody
 * else's work to the whole class — changing the canvas and changing the
 * audience are different powers. The rule is creator, workspace admin, or
 * platform admin, which is what the row policy's twin
 * (`check_workflows_update_allowed`, migration 338) already enforces for the
 * browser: it pins `visibility` — alongside `project_id` and the public-share
 * levers — to `workflow_access() = 'own' OR workspace_role() = 'admin'`.
 *
 * It has its OWN service member rather than being assembled here, because the
 * workspace-admin half is not something core can compute: an organization
 * owner or admin is an IMPLICIT admin of every workspace under it and has no
 * `workspace_members` row to read. Deriving that in core would be a third
 * implementation of a rule that already has two.
 *
 * Fallback — no plugin, no member, or the flag off — is the creator alone.
 * Strictly narrower than the row policy, so nothing widens while the plugin
 * half is still on its way.
 */
export async function canChangeWorkflowVisibility(
  userId: string,
  workflowId: string,
): Promise<boolean> {
  const orgs = accessCapableOrgs()
  if (!orgs) return (await creatorOnly(userId, workflowId)) === "own"
  return orgs.canChangeWorkflowVisibility(userId, workflowId)
}

/**
 * May this user hand access to somebody ELSE?
 *
 * A fifth question, and deliberately WIDER than changing visibility: a
 * workspace can be configured to let ordinary editors invite further
 * collaborators (`collaborators_can_invite`, which a team preset turns on and
 * a school preset leaves off), while nobody but the creator or an admin gets
 * to publish the work to the whole class.
 *
 * Core asks rather than deriving it for the same reason as the rest: the
 * answer turns on a workspace's inherited settings and on implicit
 * memberships, and a second reading of either in core would be the third
 * implementation the seam exists to prevent. The UI uses it to decide whether
 * to show the invite controls at all — showing a control the server refuses
 * teaches people the product is broken, and hiding one it would accept teaches
 * them a rule that is not the real one.
 */
export async function canShareWorkflow(userId: string, workflowId: string): Promise<boolean> {
  const orgs = accessCapableOrgs()
  if (!orgs) return (await creatorOnly(userId, workflowId)) === "own"
  return orgs.canShareWorkflow(userId, workflowId)
}
