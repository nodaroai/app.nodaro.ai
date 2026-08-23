import type { FastifyInstance } from "fastify"
import { WORKSPACE_HEADER_LOWER } from "@nodaro/shared"
import { config } from "../config.js"
import type { McpSession } from "./session.js"

/**
 * The one place an MCP tool reaches a route.
 *
 * Every tool that does real work dispatches through `fastify.inject()` with
 * the internal-orchestrator secret, because an MCP session has no user JWT to
 * replay. That made the headers a per-call-site decision, and a per-call-site
 * decision is one a new tool gets wrong by omission.
 *
 * The header that matters is the workspace. A browser sends it from ONE place
 * (`frontend/src/lib/api.ts`) on every request, so the tab's switcher and the
 * server agree by construction. This is the MCP half of that: the session's
 * selection travels with every injected request, and a tool author cannot
 * forget it because there is nothing to remember.
 *
 * Why it exists BEFORE any route reads `req.workspaceId`: when content scoping
 * lands, the browser will already be sending the header and MCP would not be.
 * `list_workspaces` would report a workspace as SELECTED while the work landed
 * in the personal space — silently, in the tenancy axis, with nothing failing
 * loudly. That gap would depend on someone remembering MCP exists; this does
 * not. Today the session's workspace is always undefined (organizations are
 * off everywhere), so the header is absent and the call is byte-identical to
 * the one it replaces.
 *
 * `headers` is spread FIRST on purpose: a caller adds what its route needs
 * (`x-internal-user-id`, say) and cannot override the two this function owns.
 */
export interface McpInjectOptions {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  url: string
  payload?: string | object | Buffer
  query?: Record<string, string>
  /** Extra headers this route needs. Cannot override the secret or workspace. */
  headers?: Record<string, string>
}

export function mcpInject(fastify: FastifyInstance, session: McpSession, opts: McpInjectOptions) {
  return fastify.inject({
    method: opts.method,
    url: opts.url,
    ...(opts.query ? { query: opts.query } : {}),
    headers: {
      ...opts.headers,
      "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
      ...(session.workspaceId ? { [WORKSPACE_HEADER_LOWER]: session.workspaceId } : {}),
    },
    ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
  })
}
