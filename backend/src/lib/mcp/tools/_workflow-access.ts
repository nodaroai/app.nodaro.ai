import { supabase } from "../../supabase.js"
import {
  accessAtLeast,
  workflowAccessFromRow,
  type AccessLevel,
} from "../../workflow-access.js"
import { toAccessRow } from "../../workflow-route-access.js"
import { ensureMcpProject } from "./_mcp-project.js"
import type { McpSession } from "../session.js"

/**
 * Loading a workflow BY ID for an MCP tool, with the right scoping for the
 * caller's context — and preserving what the REST routes do NOT have.
 *
 * The by-id MCP tools have always scoped TWO ways: to the caller (`user_id`)
 * AND to the isolated "mcp" project, so an agent never reaches into the
 * workflows a person hand-built in the UI. The REST routes have no such project
 * floor, so P10's `workflowAccess` — which answers on ownership and workspace
 * membership alone — is NOT a drop-in here: swapping it in unconditionally
 * would let an MCP agent read and run every workflow its user created anywhere,
 * a capability widening that would take effect the moment this shipped, flag or
 * no flag.
 *
 * So the scoping forks on whether a WORKSPACE is selected:
 *
 *  - **No workspace** (every caller today, and every caller while
 *    `ORGS_ENABLED` is off): unchanged — creator plus the "mcp" project. Byte
 *    -identical to what these tools do now.
 *  - **Workspace selected**: the P10 access rule decides, exactly as the REST
 *    by-id routes do — a member reaches the class's shared work, an outsider
 *    does not, and the project floor no longer applies because the workspace IS
 *    the scope.
 *
 * `none`/insufficient answers "not found", the same answer these tools have
 * always given for a workflow the caller may not reach — an MCP client learns
 * nothing about a workflow it cannot see.
 */

export type McpWorkflowLoad =
  | { ok: true; row: Record<string, unknown>; access: AccessLevel }
  | { ok: false; message: string }

const NOT_FOUND = "Workflow not found"

/**
 * @param cols  the columns the tool needs. In the workspace branch the access
 *              columns (`user_id, workspace_id, visibility`) are added
 *              automatically, so a caller only lists what it will USE.
 */
export async function loadMcpWorkflow(
  session: McpSession,
  workflowId: string,
  min: Exclude<AccessLevel, "none">,
  cols: string,
  // Whether the no-workspace branch confines the read to the "mcp" project.
  // True for the tools that live in that project (get/json/update/delete/run);
  // false for `export_workflow`, which has always been able to export ANY of
  // the caller's workflows, not just MCP-created ones.
  opts: { personalProjectFloor?: boolean } = {},
): Promise<McpWorkflowLoad> {
  const projectFloor = opts.personalProjectFloor !== false
  if (session.workspaceId) {
    const { select, added } = ensureAccessCols(cols)
    const { data, error } = await supabase
      // tenant-scope-ignore: this read IS the access question — judged below by
      // the P10 seam, exactly as the REST by-id routes judge it.
      .from("workflows")
      .select(select)
      .eq("id", workflowId)
      .maybeSingle()
    if (error) return { ok: false, message: `Error: ${error.message}` }
    if (!data) return { ok: false, message: NOT_FOUND }
    const row = data as unknown as Record<string, unknown>
    const access = await workflowAccessFromRow(session.userId, toAccessRow(row))
    if (!accessAtLeast(access, min)) return { ok: false, message: NOT_FOUND }
    // Strip the columns only the access rule needed, so the row the tool sees
    // carries exactly what it selected — identical in shape to the no-workspace
    // branch below.
    for (const c of added) delete row[c]
    return { ok: true, row, access }
  }

  // No workspace: the long-standing scoping, unchanged. Creator always; the
  // "mcp" project floor only for the tools that carried it.
  let q = supabase
    .from("workflows")
    .select(cols)
    .eq("id", workflowId)
    .eq("user_id", session.userId)
  if (projectFloor) {
    q = q.eq("project_id", await ensureMcpProject(session))
  }
  const { data, error } = await q.maybeSingle()
  if (error) return { ok: false, message: `Error: ${error.message}` }
  if (!data) return { ok: false, message: NOT_FOUND }
  // A caller-and-project-scoped row is the caller's own: `own` is the honest
  // level, and it satisfies every `min` these tools ask for.
  return { ok: true, row: data as unknown as Record<string, unknown>, access: "own" }
}

/** The columns the access rule reads, added to the select if not already there. */
function ensureAccessCols(cols: string): { select: string; added: string[] } {
  const have = new Set(cols.split(",").map((c) => c.trim()))
  const added = ["id", "user_id", "workspace_id", "visibility"].filter((c) => !have.has(c))
  return { select: added.length ? `${cols}, ${added.join(", ")}` : cols, added }
}
