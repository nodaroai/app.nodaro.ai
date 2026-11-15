/**
 * `MCP_ALLOWED_CLIENT_IDS` (decided 2026-11-11): the clients this deployment
 * lets use its MCP endpoint, named by `client_id`. Pure and import-free, so
 * `config.ts` can refuse a malformed value at boot and the funnel
 * (`lib/mcp-listed-clients.ts`) reads the same parse.
 *
 * Unset or blank: no list — every MCP lever keeps its meaning, byte for byte
 * (Railway often defines a variable as empty, which must not switch anything
 * on). Otherwise a comma-separated list where each entry, trimmed, is the id
 * of a developer app (`app_` + 32 lowercase hex — the shape
 * `POST /v1/developer-apps` mints). Anything else is refused at boot, naming
 * the entry: an empty entry, a stray character, and above all a client that
 * registered itself (`ndr_dcr_…`, dynamic registration and community
 * instances alike) — such a client chose its own name and can never be one the
 * deployment set up, so it can never be listed.
 */

export const DEVELOPER_APP_CLIENT_ID = /^app_[0-9a-f]{32}$/
const SELF_REGISTERED_CLIENT_ID = /^ndr_dcr_/

export type McpClientIdsParse =
  | { ok: true; ids: ReadonlySet<string> | null }
  | { ok: false; problem: string }

export function parseMcpAllowedClientIds(raw: string | undefined): McpClientIdsParse {
  if (raw === undefined || raw.trim() === "") return { ok: true, ids: null }
  const ids = new Set<string>()
  for (const [i, part] of raw.split(",").entries()) {
    const entry = part.trim()
    if (entry === "") return { ok: false, problem: `MCP_ALLOWED_CLIENT_IDS entry ${i + 1} is empty (no stray commas)` }
    if (SELF_REGISTERED_CLIENT_ID.test(entry)) {
      return { ok: false, problem: `MCP_ALLOWED_CLIENT_IDS entry ${i + 1} is a client that registered itself; only a developer app the deployment created (app_…) can be listed` }
    }
    if (!DEVELOPER_APP_CLIENT_ID.test(entry)) {
      return { ok: false, problem: `MCP_ALLOWED_CLIENT_IDS entry ${i + 1} is not a developer app client_id (app_ followed by 32 lowercase hex characters)` }
    }
    ids.add(entry)
  }
  return { ok: true, ids }
}

/** For `config.ts`'s boot check: the problem with the value, or null when it is usable. */
export function mcpAllowedClientIdsProblem(env: { MCP_ALLOWED_CLIENT_IDS?: string }): string | null {
  const parsed = parseMcpAllowedClientIds(env.MCP_ALLOWED_CLIENT_IDS)
  return parsed.ok ? null : parsed.problem
}
