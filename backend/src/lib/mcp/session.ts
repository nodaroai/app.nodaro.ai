import type { Scope } from "../scopes.js"

/**
 * Per-request MCP session state.
 *
 * Created fresh for each authenticated MCP request via {@link newSession}; never
 * cached across requests because the (userId, scopes, clientName) tuple varies
 * per OAuth token. The MCP server in `./server.ts` owns one of these for its
 * lifetime and tools close over it for identity + scope checks.
 */
export interface McpSession {
  userId: string
  scopes: Scope[]
  clientName: string
  /**
   * Reserved for v1.2 progress streaming — tools will register progress tokens
   * here and the orchestrator will look them up to emit `notifications/progress`.
   * Unused in v1.0; the field exists so the type is stable across the v1.x line.
   */
  progressTokens?: Map<string, string>
  /** Cached mcp-project id — set by ensureMcpProject() on first call, reused thereafter. */
  mcpProjectId?: string
}

export function newSession(opts: {
  userId: string
  scopes: Scope[]
  clientName: string
}): McpSession {
  return { ...opts, progressTokens: new Map() }
}
