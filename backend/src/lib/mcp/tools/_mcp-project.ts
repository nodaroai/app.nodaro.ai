import { supabase } from "../../supabase.js"
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
