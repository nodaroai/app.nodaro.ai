import type { FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { sendInternalError } from "./http-errors.js"
import { accessAtLeast, workflowAccessFromRow, type AccessLevel } from "./workflow-access.js"
import type { WorkflowAccessRow } from "./private-plugins/types.js"

/**
 * Turning a workflow row a route already loaded into the facts the access rule
 * reads — and refusing to guess when the row does not carry them.
 *
 * Separate from `workflow-access.ts`, which is the seam itself: this is the
 * route-side half, and it exists because every by-id route needs the same two
 * steps and the second one has a trap in it.
 */

/** The columns any route must select for its row to be judgeable. */
export const WORKFLOW_ACCESS_COLS = "id, user_id, workspace_id, visibility"

/**
 * Thrown when a route hands over a row that cannot be judged.
 *
 * A programming error, not a user error, and it is deliberately loud: the
 * alternative is the silent version described below.
 */
export class UnjudgeableWorkflowRow extends Error {
  constructor(missing: string) {
    super(`workflow row cannot be judged: "${missing}" was not selected`)
    this.name = "UnjudgeableWorkflowRow"
  }
}

/**
 * The facts the access rule reads, off a row a route already has.
 *
 * **Absence must never be read as a value here.** The obvious spelling —
 * `row.workspace_id ?? null` — turns a column the query FORGOT to select into
 * a confident "this workflow is personal", and personal is the permissive
 * answer in three directions at once: the rule then skips the suspension
 * check, skips the archived-workspace cap, and skips the cap that holds a
 * non-member's editor grant down to `view`. A route one column short of
 * correct would hand an outsider `edit` on a class's work, and nothing in the
 * type system would say so — `Record<string, unknown>` makes a missing key and
 * a null key the same shape.
 *
 * So a missing key throws. A route that cannot be judged does not get judged
 * leniently; it fails, loudly, in a test long before production, and pinned by
 * a guard test that calls every converted route with a short projection.
 *
 * A NULL `workspace_id` is a real and ordinary answer — personal work — and
 * passes through untouched. It is only ABSENCE that is refused.
 */
export function toAccessRow(row: Record<string, unknown>): WorkflowAccessRow {
  if (!("id" in row)) throw new UnjudgeableWorkflowRow("id")
  if (!("user_id" in row)) throw new UnjudgeableWorkflowRow("user_id")
  if (!("workspace_id" in row)) throw new UnjudgeableWorkflowRow("workspace_id")
  if (!("visibility" in row)) throw new UnjudgeableWorkflowRow("visibility")
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    workspace_id: (row.workspace_id as string | null) ?? null,
    visibility: (row.visibility as string | null) ?? "private",
  }
}

export type LoadedWorkflow =
  | { ok: true; row: Record<string, unknown>; access: AccessLevel }
  | { ok: false }

/**
 * Load a workflow BY ID and decide what this caller may do with it.
 *
 * The replacement for `.eq("id", id).eq("user_id", userId)`, which was the same
 * sentence with the answer already assumed. The row is now read unfiltered and
 * the access seam judges it — because inside a workspace the person entitled to
 * open a workflow is very often not the person who created it, and a query that
 * filters by creator decides that question before asking it.
 *
 * Note what is NOT consulted: `req.workspaceId`. The header selects list scope
 * and create target; an operation on an identified object is authorized from
 * that object's own `workspace_id`, which is what the seam reads. Letting the
 * header in here would mean the same workflow answered differently depending on
 * what the client last selected.
 *
 * The two refusals are deliberately different and both are load-bearing:
 *
 *   - `none` → **404**, the answer this product has always given. A workflow
 *     you cannot reach is indistinguishable from one that does not exist, and
 *     a 403 here would confirm to a stranger that an id is real.
 *   - `view` but not enough → **403**. At that point the caller can already
 *     see the workflow, so there is nothing left to hide and "you may look,
 *     not touch" is the honest answer.
 *
 * Returns `{ ok: false }` once it has sent a reply, so callers read
 * `if (!loaded.ok) return`.
 */
export async function loadWorkflowFor(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  workflowId: string,
  min: Exclude<AccessLevel, "none">,
  cols: string,
  failureMessage: string,
): Promise<LoadedWorkflow> {
  const { data, error } = await supabase
    // The read IS the access question: it fetches the row in order to decide
    // who may reach it, and filtering by the caller would answer first.
    // tenant-scope-ignore: authorization follows immediately, below.
    .from("workflows")
    .select(cols)
    .eq("id", workflowId)
    .maybeSingle()

  if (error) {
    sendInternalError(reply, req, error, failureMessage)
    return { ok: false }
  }
  if (!data) {
    reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
    return { ok: false }
  }

  const row = data as unknown as Record<string, unknown>
  const access = await workflowAccessFromRow(userId, toAccessRow(row))
  if (access === "none") {
    reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
    return { ok: false }
  }
  if (!accessAtLeast(access, min)) {
    reply.status(403).send({
      error: { code: "forbidden", message: "You do not have permission to do that" },
    })
    return { ok: false }
  }
  return { ok: true, row, access }
}
