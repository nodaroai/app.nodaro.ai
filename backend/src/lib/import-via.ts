/**
 * How a request reached an import of a link (`ImportVia`, lib/content-rights.ts),
 * from how it was authenticated: a person's own session (`jwt`), a personal
 * API key or billing key (`api`), a connected OAuth app (`app`), or an AI
 * agent through the MCP server (`mcp` — the MCP verbs reach the routes on the
 * internal lane and mark their requests, `lib/mcp/internal-request.ts`).
 *
 * The orchestrator's own hops are internal too: a run carries the way it was
 * started (`WorkflowExecutionJob.importVia`), and the engine's internal
 * requests pass it on in `IMPORT_VIA_HEADER` (`sync-lane-headers.ts`), so a
 * node that imports a link inside a run started by a key or an agent is held
 * to the same authorization as the run's own fetch. An internal request that
 * names nothing (a trigger's run, a server's own relay) has no way in and no
 * standing authorization stands for it.
 */
import type { FastifyRequest } from "fastify"
import type { ImportVia } from "./content-rights.js"
import { firstHeaderValue } from "./request-helpers.js"

/**
 * The header an internal request names its originating way in with. An
 * `x-internal-*` name on purpose: the host owns every such header, and a
 * private plugin's own requests have them stripped before they are sent
 * (`lib/private-plugins/toolkit.ts`, `callerHeaders`), so a plugin cannot
 * name a way in for the user it acts as.
 */
export const IMPORT_VIA_HEADER = "x-internal-import-via"

const VIAS: ReadonlySet<string> = new Set<ImportVia>(["session", "api", "app", "mcp"])

/** `value` as an `ImportVia`, or null for anything else. */
export function parseImportVia(value: unknown): ImportVia | null {
  return typeof value === "string" && VIAS.has(value) ? (value as ImportVia) : null
}

/**
 * What a worker job carries of its route's request (`workers/shared.ts`,
 * `importRightsOf`): the way in, and the connected app and grant when the
 * request came through one, so the job's derived confirmation records them
 * as the route's own import would.
 */
export interface ImportJobFields {
  readonly importVia?: ImportVia
  readonly importAppId?: string
  readonly importAuthorizationId?: string
}

export function importJobFields(req: Pick<FastifyRequest, "authKind" | "headers" | "appAuthorization">): ImportJobFields {
  const via = importViaOf(req)
  const grant = req.appAuthorization
  return {
    ...(via ? { importVia: via } : {}),
    ...(grant?.appId ? { importAppId: grant.appId } : {}),
    ...(grant?.authorizationId ? { importAuthorizationId: grant.authorizationId } : {}),
  }
}

/** The way in of a request, or null for an internal request that names none. */
export function importViaOf(req: Pick<FastifyRequest, "authKind" | "headers">): ImportVia | null {
  switch (req.authKind) {
    case "jwt":
      return "session"
    case "api_token":
    case "billing_key":
      return "api"
    case "app_token":
      return "app"
    case "internal":
      // The header is read on the internal lane only: an outside caller
      // cannot name a way in, the auth hook decided theirs.
      return parseImportVia(firstHeaderValue(req.headers[IMPORT_VIA_HEADER]))
    default:
      return null
  }
}
