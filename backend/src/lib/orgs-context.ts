import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { WORKSPACE_HEADER_LOWER } from "@nodaro/shared"
import { hasOrganizations } from "./config.js"
import { getPluginServices } from "./private-plugins/load.js"
import { firstHeaderValue } from "./request-helpers.js"
import type { PluginMemberships } from "./private-plugins/types.js"

/**
 * Workspace request context — a core seam with no behaviour of its own.
 *
 * When organizations are enabled AND a private plugin provides the `orgs`
 * service, this asks it to validate the caller's workspace selection once per
 * request and stamps the answer on the request. Otherwise it is a no-op:
 * `req.workspaceId` stays undefined, `req.orgs()` resolves to no memberships,
 * and the header is ignored entirely rather than rejected — community and
 * business builds never install the plugin, so a client that sends the header
 * against them simply gets unscoped behaviour.
 *
 * The header selects LIST scope and CREATE target. It is never consulted to
 * authorize an operation on an identified object; that is the object's own
 * `workspace_id`, resolved where the object is loaded.
 */

const EMPTY_MEMBERSHIPS: PluginMemberships = { organizations: [], workspaces: [] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

declare module "fastify" {
  interface FastifyRequest {
    /** Active workspace for this request, when one was selected and validated. */
    workspaceId?: string
    /** Organization owning `workspaceId`. */
    orgId?: string
    /**
     * The caller's memberships, loaded on first call and memoized for the
     * request. Resolves to empty when organizations are off. Assigned in
     * `onRequest`, so it is present on EVERY request — including one an
     * earlier hook rejects, which `onSend` / `onError` / the error handler
     * still observe.
     */
    orgs: () => Promise<PluginMemberships>
  }
}

/**
 * Routes that ESTABLISH identity, where a stale selection must not lock the
 * caller out. A client that cached a workspace it has since been removed from
 * would otherwise be unable to call the very endpoint that tells it so.
 * Every other route keeps the strict refusal.
 *
 * Matched against Fastify's ROUTE PATTERN, never the raw URL: the pattern is
 * exact, so no crafted path (`/v1/invitations//accept`, an encoded slash, a
 * traversal segment) can be made to look like one of these, and a trailing
 * slash or a proxy's normalisation cannot make a real one stop matching. A
 * request that matched no route has no pattern, which reads as "not an
 * identity route" — the strict side, which is the safe default here.
 */
const IDENTITY_ROUTES: ReadonlySet<string> = new Set([
  "GET /v1/me",
  "GET /v1/workspaces",
  "POST /v1/invitations/:token/accept",
])

export function isIdentityRoute(method: string, routePattern: string | undefined): boolean {
  if (!routePattern) return false
  return IDENTITY_ROUTES.has(`${method.toUpperCase()} ${routePattern}`)
}

/** The identity routes, for a guard test to check against the real route table. */
export function identityRoutePatterns(): readonly string[] {
  return [...IDENTITY_ROUTES]
}

/**
 * Registers the context hooks. The `preHandler` must run AFTER
 * `registerAuthHook`, which is what resolves the identity it validates
 * against.
 */
export function registerOrgsContextHook(app: FastifyInstance): void {
  // Before auth, so `req.orgs` exists even on a request auth rejects — the
  // type promises it is always callable, and the error paths observe it.
  app.addHook("onRequest", async (req: FastifyRequest) => {
    let memberships: Promise<PluginMemberships> | undefined
    req.orgs = () => {
      if (!memberships) memberships = loadMemberships(req)
      return memberships
    }
  })

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const orgs = hasOrganizations() ? getPluginServices().orgs : undefined
    if (!orgs || !req.userId) return

    // `|| undefined`, not `??`: an EMPTY header is not a selection. Treating
    // it as one would let a workspace-bound token escape its binding — the
    // empty string is falsy, so `?? token` would not fall back, and the
    // mismatch guard would not fire either.
    const rawHeader = firstHeaderValue(req.headers[WORKSPACE_HEADER_LOWER])?.trim() || undefined
    // A personal API token may be BOUND to one workspace, in which case it
    // acts as an implicit header and an explicit header must agree. The
    // column that carries the binding arrives with content scoping; reading
    // it defensively here means the seam is complete the moment it does.
    const tokenWorkspaceId =
      (req.apiToken as { workspaceId?: string | null } | undefined)?.workspaceId ?? undefined
    if (!rawHeader && !tokenWorkspaceId) return

    if (rawHeader && !UUID_RE.test(rawHeader)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Workspace header must be a uuid" },
      })
    }

    const result = await orgs.resolveRequestContext({
      userId: req.userId,
      headerWorkspaceId: rawHeader,
      tokenWorkspaceId,
      identityRoute: isIdentityRoute(req.method, req.routeOptions?.url),
    })

    if (result.reject) {
      return reply.status(result.reject.status).send({
        error: { code: result.reject.code, message: result.reject.message },
      })
    }
    req.workspaceId = result.workspaceId
    req.orgId = result.orgId
  })
}

async function loadMemberships(req: FastifyRequest): Promise<PluginMemberships> {
  const orgs = hasOrganizations() ? getPluginServices().orgs : undefined
  if (!orgs || !req.userId) return EMPTY_MEMBERSHIPS
  try {
    return await orgs.loadMemberships(req.userId)
  } catch (err) {
    // Memberships are an optimization for list scoping, never the thing that
    // authorizes an object. Failing closed (no memberships) is the safe
    // answer and keeps a Redis blip from 500ing every request.
    req.log.error({ err }, "orgs: membership load failed")
    return EMPTY_MEMBERSHIPS
  }
}
