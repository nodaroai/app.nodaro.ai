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
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "mcp")
    .order("created_at", { ascending: true })
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

  const { data: created, error } = await supabase
    .from("projects")
    .insert({
      user_id: session.userId,
      name: "mcp",
      description: "Workflows managed via MCP",
    })
    .select("id")
    .single()

  if (created?.id) {
    session.mcpProjectId = created.id as string
    return session.mcpProjectId
  }

  // A concurrent first-use request may have inserted the row between our
  // SELECT and INSERT. Re-select the oldest instead of failing — converges
  // on the winner rather than erroring or compounding duplicates.
  const raced = await findOldestMcpProject(session.userId)
  if (raced) {
    session.mcpProjectId = raced
    return raced
  }

  throw new Error(`Failed to create mcp project: ${error?.message ?? "unknown"}`)
}
