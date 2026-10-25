/**
 * Which MCP conversation a request belongs to, read from the request's
 * headers only (`clientInfo` arrives on `initialize` alone, so it cannot tell
 * a later tool call apart).
 *
 * What each client sends was measured on production (2026-10-24, two separate
 * chats per client):
 *  - ChatGPT sends `x-openai-session`, one value per chat for the chat's whole
 *    life (a chat continued later keeps it, a new chat gets a new one).
 *  - Claude Code echoes the `mcp-session-id` this server returns on
 *    `initialize` (`fastify-adapter.ts`), one per launch.
 *  - Claude.ai also echoes an `mcp-session-id`, but the same one across
 *    separate chats: it marks the connector, not the chat, so it is not used.
 *    Claude.ai (and any other client) falls back to the time gap in
 *    `conversation-store.ts`.
 */

export type McpConversationClient = "chatgpt" | "claude-code" | "claude" | "other"

export interface McpConversationIdentity {
  readonly client: McpConversationClient
  /** A value constant within one chat, or null when the client sends none (time-gap fallback). */
  readonly key: string | null
}

type Headers = Record<string, string | string[] | undefined>

/** Longest key kept: the measured values are under 100 characters. */
const MAX_KEY_LENGTH = 200

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name]
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = first?.trim()
  return trimmed ? trimmed : undefined
}

function keyOf(value: string | undefined): string | null {
  if (!value) return null
  return value.length > MAX_KEY_LENGTH ? value.slice(0, MAX_KEY_LENGTH) : value
}

/** The client and its per-chat key, in the order the measurement established. */
export function conversationIdentityFromHeaders(headers: Headers, clientName: string): McpConversationIdentity {
  const openAiSession = header(headers, "x-openai-session")
  const userAgent = header(headers, "user-agent") ?? ""
  if (openAiSession || userAgent.startsWith("openai-mcp")) {
    return { client: "chatgpt", key: keyOf(openAiSession) }
  }
  const anthropicClient = header(headers, "x-anthropic-client")
  if (anthropicClient === "ClaudeCode" || userAgent.startsWith("claude-code/")) {
    return { client: "claude-code", key: keyOf(header(headers, "mcp-session-id")) }
  }
  if (anthropicClient === "ClaudeAI" || userAgent === "Claude-User" || /claude/i.test(clientName)) {
    return { client: "claude", key: null }
  }
  return { client: "other", key: null }
}
