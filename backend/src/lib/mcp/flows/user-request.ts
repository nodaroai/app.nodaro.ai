import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"
import { FLOW_TOOLS } from "./node-mappers.js"

/**
 * The user's own words, from the assistant.
 *
 * MCP carries a tool's arguments, never the chat message that led to the
 * call, so the tools whose calls become conversation nodes take one optional
 * argument, `user_request`, that the assistant is asked to fill with the
 * user's latest message. It is taken off the arguments before the tool runs
 * (no tool sees it) and kept on the request's session, where the conversation
 * writer reads it for the node's "Where it came from" and the conversation's
 * name.
 *
 * Measured on production (2026-10-24): Claude Code filled it on 31 of 32
 * calls, word for word; Claude.ai on 3 of 6; ChatGPT never saw it, because it
 * kept the tool list it cached when the connector was added. Every reader
 * therefore treats it as optional.
 */

/** The tools whose calls become conversation nodes: derived from the mappers (`node-mappers.ts`). */
export const USER_REQUEST_TOOLS: ReadonlySet<string> = FLOW_TOOLS

/** Longest request kept. */
export const USER_REQUEST_MAX = 4000

export const USER_REQUEST_DESCRIPTION = "The user's latest message to you, word for word."

const USER_REQUEST_SCHEMA = z.string().max(USER_REQUEST_MAX).optional().describe(USER_REQUEST_DESCRIPTION)

export const FLOW_ID_DESCRIPTION = '"new" starts a flow; a flow id from a result continues it.'

/**
 * `flow_id`: "new", or a conversation's workflow id. Checked here rather than
 * as a schema pattern: the pattern would ride every tool list on every
 * client, and a value that is neither is simply ignored (the step joins this
 * chat's flow), never a refused call.
 */
const FLOW_ID_SCHEMA = z.string().max(36).optional().describe(FLOW_ID_DESCRIPTION)

const FLOW_ID = /^(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

type ToolCallback = (...args: unknown[]) => unknown

function isRawShape(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === "object" && schema !== null && !("_def" in schema) && !("~standard" in schema)
}

/**
 * Patch `server.registerTool` (before any tool is registered) so the listed
 * tools take `user_request`, and every tool records its own name on the
 * session. The argument is removed before the tool's handler runs.
 */
export function attachUserRequest(server: McpServer, session: McpSession, tools: ReadonlySet<string> = USER_REQUEST_TOOLS): void {
  const original = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: ToolCallback) => unknown
  const patched = (name: string, config: Record<string, unknown>, cb: ToolCallback): unknown => {
    const shape = config?.inputSchema
    // A tool declared with a full schema object (not a field map) is left as it is.
    if (!tools.has(name) || (shape !== undefined && !isRawShape(shape))) {
      const named: ToolCallback = (...args) => {
        session.currentTool = name
        return cb(...args)
      }
      return original(name, config, named)
    }
    const hadArgs = shape !== undefined
    const wrapped: ToolCallback = (args, extra) => {
      const { user_request: userRequest, flow_id: flowId, ...rest } = (args ?? {}) as Record<string, unknown>
      session.currentTool = name
      session.flowRequest = typeof flowId === "string" && FLOW_ID.test(flowId.trim()) ? flowId.trim().toLowerCase() : undefined
      const text = typeof userRequest === "string" ? userRequest.trim() : ""
      session.userRequest = text ? text : undefined
      // A tool with no arguments is called with `extra` alone, as the SDK would have.
      return hadArgs ? cb(rest, extra) : cb(extra)
    }
    return original(name, { ...config, inputSchema: { ...(shape ?? {}), user_request: USER_REQUEST_SCHEMA, flow_id: FLOW_ID_SCHEMA } }, wrapped)
  }
  ;(server as unknown as { registerTool: typeof patched }).registerTool = patched
}
