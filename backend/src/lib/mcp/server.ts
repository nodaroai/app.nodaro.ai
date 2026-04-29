import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { newSession, type McpSession } from "./session.js"
import { passesGate, type ToolGate } from "./tool-schemas.js"
import type { Scope } from "../scopes.js"

interface BuildOpts {
  userId: string
  scopes: Scope[]
  clientName: string
}

/**
 * Build a fresh MCP server bound to a single authenticated request.
 *
 * The returned `McpServer` is **per-request**, not cached. Each OAuth token
 * carries a different (userId, scopes, clientName) tuple, so caching would
 * leak identity and scopes across users. The Fastify adapter
 * (`./fastify-adapter.ts`) calls this once per request, connects the SDK's
 * StreamableHTTP transport, and discards the server when the request ends.
 *
 * Scope-gated tool registration: each tool declares a {@link ToolGate}; tools
 * whose gate isn't satisfied by `opts.scopes` are silently omitted, so they
 * don't appear in `tools/list`. The placeholder `ping` tool has an empty gate
 * (always visible) and exists primarily as a connectivity check — clients can
 * call it to verify the OAuth token resolved to the expected Nodaro user.
 */
export function buildMcpServer(opts: BuildOpts): McpServer {
  const session = newSession(opts)
  const server = new McpServer(
    { name: "nodaro-mcp", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  )
  registerPing(server, session)
  return server
}

const pingGate: ToolGate = { required: [] }

function registerPing(server: McpServer, session: McpSession): void {
  if (!passesGate(session, pingGate)) return
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Returns 'pong' plus the authenticated Nodaro user id and the calling MCP client. Useful for verifying that the connector is wired up correctly.",
      // Empty raw shape = no input arguments. The SDK's registerTool API takes
      // a `ZodRawShapeCompat` (Record<string, ZodTypeAny>), NOT a wrapped
      // ZodObject — passing `z.object({})` here would type-error.
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `pong (userId: ${session.userId}, client: ${session.clientName})`,
        },
      ],
    }),
  )
}
