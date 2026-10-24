import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

/**
 * Temporary experiment (2026-10-24): what, if anything, tells one MCP
 * conversation from another?
 *
 * Claude, ChatGPT and Claude Code keep a conversation id but send none to an
 * MCP server, and this server runs stateless, so it never issues the
 * protocol's `Mcp-Session-Id` either. With `MCP_SESSION_PROBE=true` (meant for
 * staging only) the server hands every `initialize` a fresh session id, and
 * logs for each request the id the client echoes back plus the request's
 * `_meta` and non-secret headers. Opening two chats per client then shows
 * which value stays constant inside a chat and changes between chats.
 *
 * Stateless mode does not validate an incoming session id (the SDK's
 * `validateSession` returns early when `sessionIdGenerator` is undefined), so
 * issuing one changes nothing else about how a request is served.
 *
 * Remove once the rule for where one MCP conversation ends is decided.
 */

export function sessionProbeEnabled(): boolean {
  const v = process.env.MCP_SESSION_PROBE
  return v === "true" || v === "1"
}

/** A new id for an `initialize` response; the client echoes it on every later request. */
export function probeSessionId(): string {
  return randomUUID()
}

// Credentials, and client addresses (never logged: see the presence notes in backend/CLAUDE.md).
const SECRET_NAME = /auth|cookie|token|secret|key|password|signature|forwarded|(^|-)ip($|-)|^cf-|true-client/i
const MAX_VALUE = 160

/** Never a credential or an address: such names are dropped, long values are cut. */
function safeValue(name: string, value: unknown): string | undefined {
  // progressToken is the protocol's progress counter, not a credential.
  if (name !== "progressToken" && SECRET_NAME.test(name)) return undefined
  if (value === undefined || value === null) return undefined
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text
}

function safeRecord(input: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(input ?? {})) {
    const safe = safeValue(name, value)
    if (safe !== undefined) out[name] = safe
  }
  return out
}

/**
 * What the probe logs for one request: the echoed session id, the JSON-RPC
 * `params._meta`, and the request headers, each without anything that looks
 * like a credential. Tool arguments are listed by name only, never by value.
 */
export function probeSnapshot(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Record<string, unknown> {
  const rpc = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const params = (rpc.params && typeof rpc.params === "object" ? rpc.params : {}) as Record<string, unknown>
  const meta = params._meta && typeof params._meta === "object" ? (params._meta as Record<string, unknown>) : undefined
  const args = params.arguments && typeof params.arguments === "object" ? Object.keys(params.arguments as object) : []
  const flatHeaders: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(headers)) {
    flatHeaders[name] = Array.isArray(value) ? value.join(", ") : value
  }
  return {
    method: typeof rpc.method === "string" ? rpc.method : undefined,
    tool: rpc.method === "tools/call" && typeof params.name === "string" ? params.name : undefined,
    sessionId: safeValue("mcp-session-id", flatHeaders["mcp-session-id"]),
    meta: safeRecord(meta),
    headers: safeRecord(flatHeaders),
    argumentNames: args,
    clientInfo: rpc.method === "initialize" ? safeRecord(params.clientInfo as Record<string, unknown> | undefined) : undefined,
  }
}

/**
 * Second half of the experiment: can the assistant hand us the user's own
 * words? MCP carries only a tool's arguments, never the chat message that led
 * to the call. For the accounts listed in MCP_SESSION_PROBE_USERS (user ids,
 * comma-separated) — and only while MCP_SESSION_PROBE is on — every tool gains
 * an optional `user_request` argument the assistant is asked to fill with the
 * user's latest message. It is logged (cut to 500 characters) and removed
 * before the tool runs, so no tool ever sees it. Every other account gets
 * the tool list exactly as before.
 */
export function userRequestProbeFor(userId: string | undefined): boolean {
  if (!userId || !sessionProbeEnabled()) return false
  const ids = (process.env.MCP_SESSION_PROBE_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return ids.includes(userId)
}

const USER_REQUEST_SCHEMA = z
  .string()
  .max(4000)
  .optional()
  .describe("The user's latest message to you, word for word.")

const MAX_LOGGED_REQUEST = 500

type ProbeLog = (obj: Record<string, unknown>, msg: string) => void
type ToolCallback = (...args: unknown[]) => unknown

function isRawShape(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === "object" && schema !== null && !("_def" in schema) && !("~standard" in schema)
}

/** Patch `server.registerTool` (before any tool is registered) to add and strip `user_request`. */
export function attachUserRequestProbe(server: McpServer, log: ProbeLog): void {
  const original = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: ToolCallback) => unknown
  const patched = (name: string, config: Record<string, unknown>, cb: ToolCallback): unknown => {
    const shape = config?.inputSchema
    // A tool declared with a full schema object (not a field map) is left as it is.
    if (shape !== undefined && !isRawShape(shape)) return original(name, config, cb)
    const hadArgs = shape !== undefined
    const wrapped: ToolCallback = (args, extra) => {
      const { user_request: userRequest, ...rest } = (args ?? {}) as Record<string, unknown>
      const text = typeof userRequest === "string" ? userRequest : ""
      log(
        { probe: { tool: name, filled: text.length > 0, userRequest: text.length > MAX_LOGGED_REQUEST ? `${text.slice(0, MAX_LOGGED_REQUEST)}…` : text } },
        "[mcp] user request probe",
      )
      // A tool with no arguments is called with `extra` alone, as the SDK would have.
      return hadArgs ? cb(rest, extra) : cb(extra)
    }
    return original(name, { ...config, inputSchema: { ...(shape ?? {}), user_request: USER_REQUEST_SCHEMA } }, wrapped)
  }
  ;(server as unknown as { registerTool: typeof patched }).registerTool = patched
}
