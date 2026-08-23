import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { hasOrganizations } from "../../config.js"
import { getPluginServices } from "../../private-plugins/load.js"
import { storeSessionWorkspace } from "../workspace-session.js"

const readGate: ToolGate = { required: ["workspaces:read"] }
const writeGate: ToolGate = { required: ["workspaces:write"] }

export interface RegisterWorkspacesOpts {
  server: McpServer
  session: McpSession
}

/**
 * Workspaces, for a client that has no header to send.
 *
 * A browser picks a workspace from a switcher and every request it makes
 * carries the choice. An MCP client has neither, so the same two questions
 * become tools: what may I work in, and work in this one.
 *
 * Both are THIN. They ask the plugin and report the answer; the rules about
 * who belongs to what live in one place and this is not it. `select_workspace`
 * in particular does not decide whether a workspace is selectable — it
 * proposes one and the resolver either resolves it or does not.
 *
 * Registered only where organizations exist. On every other build the tools
 * are absent rather than present-and-empty, so a client discovers there is
 * no such concept here instead of finding a switch that does nothing.
 */
export function registerWorkspaces({ server, session }: RegisterWorkspacesOpts): void {
  if (!hasOrganizations()) return
  const orgs = getPluginServices().orgs
  if (!orgs) return

  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_workspaces",
      {
        title: "List Workspaces",
        description:
          "The organizations and workspaces this account belongs to, and which " +
          "workspace this session is working in.\n\n" +
          "**When to call this tool:** whenever someone mentions a class, a team, " +
          "a school or a shared space, or asks where their work is going — so you " +
          "can name the workspace back to them instead of guessing.\n\n" +
          "The selection travels with this session's requests and is what a " +
          "workspace-aware operation reads. It does not by itself filter what a " +
          "read returns, move work that already exists, or change who can see it.\n\n" +
          "An empty result means the account belongs to no organization, which " +
          "is normal and not an error.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => {
        try {
          const me = await orgs.me(session.userId)
          const workspaces = me.workspaces as Array<{
            id: string
            orgId: string
            name: string
            archived: boolean
            role: string
          }>
          const organizations = me.organizations as Array<{ id: string; name: string; status: string }>
          const orgName = new Map(organizations.map((o) => [o.id, o.name]))

          if (workspaces.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "This account belongs to no workspaces. Everything happens in its personal space.",
                },
              ],
            }
          }

          const lines = workspaces.map((w) => {
            const marks = [w.role, w.archived ? "archived" : null, w.id === session.workspaceId ? "SELECTED" : null]
              .filter(Boolean)
              .join(", ")
            return `- ${w.name} (${orgName.get(w.orgId) ?? "unknown organization"}) — ${marks} — id ${w.id}`
          })
          const current = session.workspaceId
            ? `Currently working in ${session.workspaceId}.`
            : "Currently working in the personal space."
          return {
            content: [{ type: "text", text: `${current}\n\n${lines.join("\n")}` }],
            structuredContent: { workspaces, organizations, selectedWorkspaceId: session.workspaceId ?? null },
          }
        } catch {
          return {
            content: [{ type: "text", text: "Could not read the workspaces for this account." }],
            isError: true,
          }
        }
      },
    )
  }

  if (passesGate(session, writeGate)) {
    server.registerTool(
      "select_workspace",
      {
        title: "Select Workspace",
        description:
          "Work in a workspace for the rest of this session, and remember it for " +
          "the next one. Pass `workspace_id: null` to go back to the personal " +
          "space.\n\n" +
          "**When to call this tool:** after `list_workspaces`, once the user has " +
          "said which one they mean. Selecting records where this session's work " +
          "belongs; it grants nothing and moves nothing, so selecting the wrong " +
          "one wastes a step rather than exposing anything.",
        inputSchema: {
          workspace_id: z
            .string()
            .uuid()
            .nullable()
            .describe("A workspace id from list_workspaces, or null for the personal space"),
        },
      },
      async (args) => {
        const requested = args.workspace_id ?? null

        if (requested === null) {
          await storeSessionWorkspace(session.userId, null)
          session.workspaceId = undefined
          return { content: [{ type: "text", text: "Now working in the personal space." }] }
        }

        // The resolver decides, not this tool. `identityRoute: false` so an
        // unselectable workspace comes back as a refusal to report rather
        // than as silence that would read like success.
        const result = await orgs.resolveRequestContext({
          userId: session.userId,
          headerWorkspaceId: requested,
          identityRoute: false,
        })
        if (result.reject || !result.workspaceId) {
          return {
            content: [
              {
                type: "text",
                text:
                  result.reject?.message ??
                  "That workspace is not available to this account. Call list_workspaces to see what is.",
              },
            ],
            isError: true,
          }
        }

        // Stored only after it resolved: a preference that was never valid is
        // worse than none, because the next session pays to discover it.
        await storeSessionWorkspace(session.userId, result.workspaceId)
        session.workspaceId = result.workspaceId
        return {
          content: [{ type: "text", text: `Now working in workspace ${result.workspaceId}.` }],
          structuredContent: { workspaceId: result.workspaceId, orgId: result.orgId ?? null },
        }
      },
    )
  }
}
