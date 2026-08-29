/**
 * Spec §8 (Surfaces): the two workflow-JSON writing tools must tell an agent
 * that an AI prompt node's `data` may carry `promptPrefix` / `promptSuffix`.
 * An agent-authored node never renders the config panel, so the tool
 * description is the only place it can learn the fields exist.
 */
import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerWorkflows } = await import("../workflows.js")

const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"

async function descriptions(): Promise<Map<string, string>> {
  const session = newSession({
    userId: "u1",
    scopes: ["workflows:read", "workflows:write"] as Scope[],
    clientName: "Claude",
  })
  session.mcpProjectId = MCP_PROJECT_ID
  const server = buildServer()
  registerWorkflows({ server, session, fastify: Fastify() })
  return new Map((await listTools(server)).map((t) => [t.name, t.description ?? ""]))
}

describe("workflow JSON tools mention prompt pre/post text", () => {
  for (const tool of ["create_workflow", "update_workflow_json"]) {
    it(`${tool} description names promptPrefix and promptSuffix`, async () => {
      const description = (await descriptions()).get(tool)
      expect(description, `${tool} is not registered`).toBeDefined()
      expect(description).toContain("promptPrefix")
      expect(description).toContain("promptSuffix")
    })
  }
})
