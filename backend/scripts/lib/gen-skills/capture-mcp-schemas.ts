/**
 * Spawn a minimal MCP server (via buildMcpServer) and intercept every
 * server.registerTool() call to record the tool's name + raw Zod
 * inputSchema. After buildMcpServer returns, we have the full registry.
 *
 * Uses a registerTool prototype monkey-patch (applied before
 * buildMcpServer is imported) so we capture EVERY registration without
 * depending on undocumented SDK internals.
 *
 * Used only by backend/scripts/gen-skills.ts.
 */
import type { FastifyInstance } from "fastify"

export interface CapturedSchema {
  name: string
  inputSchema: Record<string, unknown>
  config: Record<string, unknown>
}

const DEFAULT_CAPTURE_SCOPES = [
  "workflows:read",
  "workflows:write",
  "workflows:execute",
  "assets:read",
  "assets:write",
  "jobs:read",
  "apps:read",
  "credits:read",
  "pipelines:read",
  "pipelines:execute",
  "pipelines:approve",
] as const

/**
 * Capture every registered MCP tool's name + schemas. `scopes` defaults to the
 * set gen-skills uses; pass a wider set (e.g. the full ALL_SCOPES) to capture
 * scope-gated tools like `list_node_presets` for invariant tests.
 */
export async function captureMcpToolSchemas(
  scopes: readonly string[] = DEFAULT_CAPTURE_SCOPES,
): Promise<CapturedSchema[]> {
  const captured: CapturedSchema[] = []

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js")
  const original = McpServer.prototype.registerTool
  McpServer.prototype.registerTool = function (
    this: InstanceType<typeof McpServer>,
    name: string,
    config: Record<string, unknown>,
    handler: unknown,
  ) {
    captured.push({
      name,
      inputSchema: (config.inputSchema ?? {}) as Record<string, unknown>,
      config,
    })
    return original.call(this, name, config, handler as never)
  } as typeof original

  try {
    const { buildMcpServer } = await import("../../../src/lib/mcp/server.js")
    const stubFastify = {
      inject: async () => {
        throw new Error("inject called during capture")
      },
    } as unknown as FastifyInstance
    await buildMcpServer({
      userId: "__gen_skills_capture__",
      scopes: scopes as never,
      clientName: "gen-skills",
      fastify: stubFastify,
    })
  } finally {
    McpServer.prototype.registerTool = original
  }

  return captured
}
