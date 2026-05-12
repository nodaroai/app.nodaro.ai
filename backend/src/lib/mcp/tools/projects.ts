import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"

const readGate: ToolGate = { required: ["workflows:read"] }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ProjectRow {
  id: string
  name: string
  description: string | null
  created_at: string
}

/**
 * Build a `projectId → workflowCount` map for the given project ids, scoped to
 * the session user. Returns counts via a single `select("project_id")` over the
 * `workflows` table (counted in JS) — avoids an N+1 of HEAD requests and keeps
 * the supabase mock chain trivial in tests.
 */
async function workflowCountsByProject(
  userId: string,
  projectIds: string[],
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}
  const { data, error } = await supabase
    .from("workflows")
    .select("project_id")
    .eq("user_id", userId)
    .in("project_id", projectIds)
  const counts: Record<string, number> = {}
  if (error || !data) return counts
  for (const row of data as Array<{ project_id: string | null }>) {
    const pid = row.project_id
    if (!pid) continue
    counts[pid] = (counts[pid] ?? 0) + 1
  }
  return counts
}

function shapeProject(p: ProjectRow, workflowCount: number) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    workflowCount,
    createdAt: p.created_at,
  }
}

/**
 * Project-discovery tools.
 *
 * Both `list_projects` and `get_project` query Supabase directly, scoped to
 * `session.userId` (the service-role client bypasses RLS, so the manual
 * `user_id` filter is the only thing keeping projects from leaking across
 * users). Neither is restricted to the session's mcp-project — they see ALL
 * of the caller's projects.
 *
 * Gated on `workflows:read`: a project is just a folder of workflows, and the
 * same scope already governs `list_workflows`.
 */
export function registerProjectTools(server: McpServer, session: McpSession): void {
  if (!passesGate(session, readGate)) return

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description:
        "List all projects. Returns id, name, description, and workflow count for each project.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, description, created_at")
        .eq("user_id", session.userId)
        .order("name", { ascending: true })
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      const rows = (data ?? []) as ProjectRow[]
      const counts = await workflowCountsByProject(
        session.userId,
        rows.map((r) => r.id),
      )
      const shaped = rows.map((p) => shapeProject(p, counts[p.id] ?? 0))
      return {
        content: [{ type: "text", text: JSON.stringify({ data: shaped }, null, 2) }],
      }
    },
  )

  server.registerTool(
    "get_project",
    {
      title: "Get Project",
      description:
        "Get a single project by its ID or name. Returns id, name, description, workflow count, and created_at.",
      inputSchema: {
        project_id: z.string().min(1).describe("Project UUID or project name"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const key = args.project_id
      let query = supabase
        .from("projects")
        .select("id, name, description, created_at")
        .eq("user_id", session.userId)
      query = UUID_RE.test(key) ? query.eq("id", key) : query.eq("name", key)
      const { data, error } = await query.maybeSingle()
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      if (!data) {
        return {
          content: [{ type: "text", text: `Project "${key}" not found` }],
          isError: true,
        }
      }
      const project = data as ProjectRow
      const counts = await workflowCountsByProject(session.userId, [project.id])
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { data: shapeProject(project, counts[project.id] ?? 0) },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
