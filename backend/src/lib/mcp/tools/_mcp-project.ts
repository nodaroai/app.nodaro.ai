import { supabase } from "../../supabase.js"
import { getPluginServices } from "../../private-plugins/load.js"
import type { McpSession } from "../session.js"

/**
 * Resolve (or create) the auto-managed "mcp" project for this session's user,
 * caching the id on the session so subsequent tool calls skip the DB lookup.
 *
 * Every workflow-mutation MCP tool (`create_workflow`, `update_workflow_json`,
 * `delete_workflow`, `import_workflow`) is scoped to this project so MCP
 * activity stays isolated from the user's hand-edited projects in the UI.
 */
/** Find the caller's oldest "mcp" project id, or null. */
async function findOldestMcpProject(userId: string): Promise<string | null> {
  // order + limit(1) → maybeSingle never errors even if a prior race created
  // duplicate "mcp" rows, and every session deterministically converges on the
  // SAME (oldest) project — so workflows can't partition across duplicates.
  // Secondary order by id breaks the (extremely unlikely) created_at tie so
  // two concurrent creators still pick the identical winner.
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "mcp")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function ensureMcpProject(session: McpSession): Promise<string> {
  // An in-app session is pinned to the open workflow's real project (see
  // `McpSession.scopedProjectId`) — no "mcp" side project is consulted or
  // created for it, and this pin wins over everything: the copilot works in
  // the project it was opened on, workspace or not. `/mcp` sessions never set
  // this and keep the behavior below.
  if (session.scopedProjectId) return session.scopedProjectId

  // A WORKSPACE selection wins over the isolated "mcp" project. When a `/mcp`
  // caller is working inside a workspace, new work lands in the workspace's own
  // landing project (spec §8.4), the same one the REST create path uses — not
  // in a per-user "mcp" side project, and NOT in a second "mcp" project per
  // workspace (that would split a member's work across two places nobody asked
  // for). The rule lives in the plugin, which owns the workspace tables; core
  // asks. Present only when organizations are enabled AND a workspace is
  // selected, so with the flag off this branch never runs and everything below
  // is byte-identical to today.
  if (session.workspaceId) {
    const landing = await getPluginServices().orgs?.workspaceDefaultProject?.(session.workspaceId)
    // Null only if the project was deleted out from under the workspace (the
    // FK is ON DELETE SET NULL). Fall through to the personal "mcp" project
    // rather than throw — a missing landing project must not brick MCP writes.
    if (landing) return landing
  }

  if (session.mcpProjectId) return session.mcpProjectId

  const existing = await findOldestMcpProject(session.userId)
  if (existing) {
    session.mcpProjectId = existing
    return existing
  }

  // Not found → create. There is NO unique constraint on projects(user_id,name)
  // (and a de-dup migration is unsafe due to ON DELETE CASCADE children), so a
  // truly-concurrent first-use request could ALSO insert one. Therefore we do
  // NOT trust our own inserted id — after inserting we re-select the OLDEST and
  // use that, so both racing creators converge on the same project and no
  // workflow is ever orphaned in a duplicate (the loser's row stays empty).
  const { error } = await supabase.from("projects").insert({
    user_id: session.userId,
    name: "mcp",
    description: "Workflows managed via MCP",
  })

  const resolved = await findOldestMcpProject(session.userId)
  if (resolved) {
    session.mcpProjectId = resolved
    return resolved
  }

  throw new Error(`Failed to create mcp project: ${error?.message ?? "unknown"}`)
}
