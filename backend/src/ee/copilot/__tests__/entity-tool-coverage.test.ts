/**
 * Every entity kind the product has must be readable by the copilot.
 *
 * The `@` picker, the canvas hydrator and the run-time hydrator all key off
 * `ENTITY_NODE_KINDS`, and the compiler finds each of their per-kind tables for
 * you. What it cannot find is a kind that has no MCP read tools, or has them
 * but is left off the copilot's allowlist — which is the shape the gap actually
 * took: characters and locations were reachable, objects and creatures were
 * not, so `@` offered half a library and the model could not resolve the rest.
 */
import { describe, expect, it } from "vitest"
import { ENTITY_NODE_KINDS } from "@nodaro/shared"
import Fastify from "fastify"
import { COPILOT_SCOPES, MCP_TOOL_ALLOWLIST } from "../constants.js"
import { buildMcpServer } from "../../../lib/mcp/server.js"
import { createMcpInvoker } from "../../../lib/mcp/invoke.js"

describe("entity read-tool coverage", () => {
  it.each(ENTITY_NODE_KINDS)("the copilot may list and get a %s", (kind) => {
    // Tool names are derivable from the kind — `list_characters` / `get_character`.
    expect(MCP_TOOL_ALLOWLIST.has(`list_${kind}s`), `list_${kind}s not allowlisted`).toBe(true)
    expect(MCP_TOOL_ALLOWLIST.has(`get_${kind}`), `get_${kind} not allowlisted`).toBe(true)
  })

  it("and those tools actually exist on the server the copilot talks to", async () => {
    // The copilot’s own scopes, so this fails if a kind’s tools register
    // behind a gate the copilot session does not hold.
    const server = await buildMcpServer({
      userId: "u1",
      scopes: [...COPILOT_SCOPES],
      clientName: "nodaro-copilot",
      fastify: Fastify(),
    })
    const tools = await createMcpInvoker(server).listTools()
    const names = new Set(tools.map((t) => t.name))
    for (const kind of ENTITY_NODE_KINDS) {
      expect(names.has(`list_${kind}s`), `list_${kind}s not registered`).toBe(true)
      expect(names.has(`get_${kind}`), `get_${kind} not registered`).toBe(true)
    }
  })
})
