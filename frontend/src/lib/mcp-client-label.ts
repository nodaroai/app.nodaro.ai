/**
 * The name an MCP client is shown by: its product, never the connection's
 * own name in parentheses ("Claude Code (nodaro)" shows as "Claude Code").
 * Mirrors the server's `sourceOf` (backend/src/lib/mcp/flows/conversation-list.ts).
 */
const PRODUCT_LABEL: Readonly<Record<string, string>> = {
  claude: "Claude",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
}

export function mcpClientLabel(client: string | null | undefined, clientName: string | null | undefined): string {
  if (client && PRODUCT_LABEL[client]) return PRODUCT_LABEL[client]
  const base = (clientName ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim()
  return base || "MCP"
}
