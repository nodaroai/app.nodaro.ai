import { supabase } from "../../supabase.js"
import type { McpSession } from "../session.js"

export async function ensureMcpProject(session: McpSession): Promise<string> {
  if (session.mcpProjectId) return session.mcpProjectId

  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", session.userId)
    .eq("name", "mcp")
    .maybeSingle()

  if (existing?.id) {
    session.mcpProjectId = existing.id as string
    return session.mcpProjectId
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

  if (error || !created?.id) throw new Error(`Failed to create mcp project: ${error?.message}`)

  session.mcpProjectId = created.id as string
  return session.mcpProjectId
}
