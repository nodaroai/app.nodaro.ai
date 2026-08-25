import { hasOrganizations } from "./config.js"
import { getPluginServices } from "./private-plugins/load.js"
import type { WorkflowDeletedAudit } from "./private-plugins/types.js"

/**
 * The organization audit trail, as core can reach it.
 *
 * The log itself is the plugin's — its table, its action vocabulary, its
 * writer. Core owns none of that and must not, so this is a seam of the same
 * shape as `workflow-access.ts`: ask, or fall back to a truthful "no".
 *
 * It is separate from that file on purpose. Access answers what somebody may
 * do; this records what they did. Folding a writer into the module every route
 * asks permission from would make one file answer two unrelated questions.
 */

/**
 * Record that a workspace workflow is about to be deleted by somebody who did
 * not create it. Resolves `false` when the row was NOT written — including
 * when no plugin supplies the member at all.
 *
 * WRITE-AHEAD, which is deliberately the opposite of the plugin's own
 * audit-after convention, and the caller must refuse the delete on `false`.
 *
 * The reason is what the wider delete power was granted FOR. The row policies
 * admit only the creator; a workspace admin can delete a member's work through
 * this route and nowhere else, and the whole justification for that asymmetry
 * is that a deletion here has a name on it. Audit-after cannot deliver that —
 * once the row is gone there is nothing to refuse, and a failed write leaves a
 * destroyed workflow nobody can attribute. So the order is inverted for this
 * one action: an audit row describing an attempt that then failed is a
 * discrepancy somebody can investigate, and it is strictly the better of the
 * two ways to be wrong about a destructive act.
 *
 * A creator deleting their own work never reaches here. Neither does any
 * personal workflow — there is no organization for the entry to belong to.
 */
export async function auditWorkflowDeleted(input: WorkflowDeletedAudit): Promise<boolean> {
  if (!hasOrganizations()) return false
  const write = getPluginServices().orgs?.auditWorkflowDeleted
  if (!write) return false
  try {
    return await write(input)
  } catch {
    // A throw is a failure to record, which is a refusal to delete. It must
    // never read as success, and it must never take the request down with it.
    return false
  }
}
