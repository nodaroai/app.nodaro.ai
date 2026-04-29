/**
 * Read `mcp_client` from a raw request body BEFORE Zod strips unknown fields.
 *
 * The MCP server sends this field on every inject()-ed request so the resulting
 * job/execution row carries the client name (e.g. "Claude") for the trigger badge.
 * Returns null for non-MCP requests.
 */
export function extractMcpClient(rawBody: unknown): string | null {
  if (!rawBody || typeof rawBody !== "object") return null
  const v = (rawBody as Record<string, unknown>).mcp_client
  if (typeof v !== "string") return null
  if (v.length === 0 || v.length > 50) return null
  return v
}
