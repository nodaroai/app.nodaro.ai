import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { WORKSPACE_HEADER } from "@nodaro/shared"

vi.mock("@/lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config.js")>("@/lib/config.js")
  return { ...actual, hasOrganizations: vi.fn(() => false) }
})
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: vi.fn(() => ({})) }))

import { hasOrganizations } from "@/lib/config.js"
import { getPluginServices } from "@/lib/private-plugins/load.js"
import { isIdentityRoute, isPlatformAdminRoute, registerOrgsContextHook } from "../orgs-context.js"
import type { PluginOrgsService } from "../private-plugins/types.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WS = "b0000000-0000-4000-8000-000000000001"
const ORG = "a0000000-0000-4000-8000-000000000001"

/**
 * A bare app with the auth-equivalent (x-user-id) plus the hooks under test,
 * registered in the same order as the real app: auth first, context after.
 * `x-reject-auth` stands in for an auth failure, so the error paths can be
 * observed. `x-token-workspace` stands in for a workspace-bound API token.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Auth stub first, then the context hooks — the same order as the real app.
  // The context hook's onRequest half runs before both regardless of when it
  // was registered, which is exactly what the rejection test relies on.
  app.addHook("preHandler", async (req, reply) => {
    const bound = req.headers["x-token-workspace"]
    if (typeof bound === "string") (req as { apiToken?: unknown }).apiToken = { workspaceId: bound }
    if (req.headers["x-reject-auth"] === "true") {
      return reply.status(401).send({ error: { code: "unauthorized", message: "no" } })
    }
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  registerOrgsContextHook(app)
  // Observes what the error paths see — this runs even for the 401 above.
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-orgs-callable", String(typeof (req as { orgs?: unknown }).orgs === "function"))
    return payload
  })
  const echo = async (req: unknown) => {
    const r = req as { workspaceId?: string; orgId?: string; orgs: () => Promise<unknown> }
    return { workspaceId: r.workspaceId ?? null, orgId: r.orgId ?? null, memberships: await r.orgs() }
  }
  app.get("/v1/anything", echo)
  app.get("/v1/me", echo)
  app.get("/v1/workspaces", echo)
  app.post("/v1/invitations/:token/accept", echo)
  app.get("/v1/admin/orgs", echo)
  await app.ready()
  return app
}

type OrgsStub = {
  [K in keyof PluginOrgsService]: ReturnType<typeof vi.fn<PluginOrgsService[K]>>
}

function orgsService(over: Partial<PluginOrgsService> = {}): OrgsStub {
  return {
    resolveRequestContext: vi.fn(async () => ({ workspaceId: WS, orgId: ORG })),
    loadMemberships: vi.fn(async () => ({
      organizations: [{ orgId: ORG, role: "member" as const, status: "active" as const }],
      workspaces: [],
    })),
    invalidateMemberships: vi.fn(async () => {}),
    me: vi.fn(async () => ({ organizations: [], workspaces: [], lastWorkspaceId: null })),
    ...over,
  } as OrgsStub
}

let app: FastifyInstance

beforeEach(async () => {
  vi.mocked(hasOrganizations).mockReturnValue(false)
  vi.mocked(getPluginServices).mockReturnValue({})
  app = await buildApp()
})
afterEach(() => app.close())

describe("orgs-context — inert without the feature or the plugin", () => {
  it("ignores the header entirely when organizations are off", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ workspaceId: null, orgId: null, memberships: { organizations: [], workspaces: [] } })
  })

  it("ignores the header when the feature is on but no plugin provides the service", async () => {
    vi.mocked(hasOrganizations).mockReturnValue(true)
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().workspaceId).toBeNull()
  })

  it("ignores the header when the plugin IS present but the feature is off", async () => {
    // This is production today: cloud always installs the plugin, and
    // ORGS_ENABLED is the launch lever. Asserting it with the service
    // present is the only way to prove the flag itself is load-bearing —
    // with both absent, either gate alone would satisfy the test.
    const orgs = orgsService()
    vi.mocked(hasOrganizations).mockReturnValue(false)
    vi.mocked(getPluginServices).mockReturnValue({ orgs })
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ workspaceId: null, orgId: null, memberships: { organizations: [], workspaces: [] } })
    expect(orgs.resolveRequestContext).not.toHaveBeenCalled()
    expect(orgs.loadMemberships).not.toHaveBeenCalled()
  })

  it("never calls the service for an unauthenticated request", async () => {
    const orgs = orgsService()
    vi.mocked(hasOrganizations).mockReturnValue(true)
    vi.mocked(getPluginServices).mockReturnValue({ orgs })
    const res = await app.inject({ method: "GET", url: "/v1/anything", headers: { [WORKSPACE_HEADER]: WS } })
    expect(res.statusCode).toBe(200)
    expect(orgs.resolveRequestContext).not.toHaveBeenCalled()
  })

  it("req.orgs is callable even on a request an earlier hook rejects", async () => {
    // The type promises it is always there, and onSend / onError / the error
    // handler all observe a rejected request. Assigning it in the preHandler
    // would leave it undefined on exactly those paths.
    vi.mocked(hasOrganizations).mockReturnValue(true)
    vi.mocked(getPluginServices).mockReturnValue({ orgs: orgsService() })
    const rejected = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-reject-auth": "true", [WORKSPACE_HEADER]: WS },
    })
    expect(rejected.statusCode).toBe(401)
    expect(rejected.headers["x-orgs-callable"]).toBe("true")

    const notFound = await app.inject({ method: "GET", url: "/v1/no-such-route" })
    expect(notFound.statusCode).toBe(404)
    expect(notFound.headers["x-orgs-callable"]).toBe("true")
  })
})

describe("orgs-context — with the plugin", () => {
  let orgs: OrgsStub

  beforeEach(() => {
    orgs = orgsService()
    vi.mocked(hasOrganizations).mockReturnValue(true)
    vi.mocked(getPluginServices).mockReturnValue({ orgs })
  })

  it("stamps the resolved workspace and org on the request", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ workspaceId: WS, orgId: ORG })
    expect(orgs.resolveRequestContext).toHaveBeenCalledWith({
      userId: USER,
      headerWorkspaceId: WS,
      tokenWorkspaceId: undefined,
      identityRoute: false,
    })
  })

  it("skips resolution entirely when no workspace was selected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/anything", headers: { "x-user-id": USER } })
    expect(res.statusCode).toBe(200)
    expect(res.json().workspaceId).toBeNull()
    expect(orgs.resolveRequestContext).not.toHaveBeenCalled()
  })

  it("sends the service's rejection verbatim", async () => {
    orgs.resolveRequestContext = vi.fn(async () => ({
      reject: { status: 403 as const, code: "not_a_member", message: "Not a member of that workspace" },
    }))
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "not_a_member", message: "Not a member of that workspace" } })
  })

  it("rejects a malformed header before asking the plugin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: "not-a-uuid" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(orgs.resolveRequestContext).not.toHaveBeenCalled()
  })

  it("marks identity-establishing routes so a stale header cannot lock the caller out", async () => {
    for (const [method, url] of [
      ["GET", "/v1/me"],
      ["GET", "/v1/workspaces"],
      ["POST", "/v1/invitations/tok123/accept"],
    ] as const) {
      await app.inject({ method, url, headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS } })
      expect(orgs.resolveRequestContext).toHaveBeenLastCalledWith(expect.objectContaining({ identityRoute: true }))
    }
  })

  it("an EMPTY header is not a selection, and cannot void a workspace-bound token", async () => {
    // The empty string is falsy, so a `??` fallback would skip the token and
    // the mismatch guard would not fire either — the token would silently
    // escape its binding into the personal space.
    await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: "", "x-token-workspace": WS },
    })
    expect(orgs.resolveRequestContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerWorkspaceId: undefined, tokenWorkspaceId: WS }),
    )
  })

  it("a whitespace-only header is treated the same as an empty one", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: "   ", "x-token-workspace": WS },
    })
    expect(res.statusCode).toBe(200)
    expect(orgs.resolveRequestContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerWorkspaceId: undefined, tokenWorkspaceId: WS }),
    )
  })

  it("a surrounding-whitespace header still names its workspace", async () => {
    await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: ` ${WS} ` },
    })
    expect(orgs.resolveRequestContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerWorkspaceId: WS }),
    )
  })

  it("passes a bound token through when no header is sent", async () => {
    await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, "x-token-workspace": WS },
    })
    expect(orgs.resolveRequestContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerWorkspaceId: undefined, tokenWorkspaceId: WS }),
    )
  })

  it("memoizes memberships per request and survives a loader failure", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/anything",
      headers: { "x-user-id": USER, [WORKSPACE_HEADER]: WS },
    })
    expect(res.json().memberships.organizations).toHaveLength(1)
    expect(orgs.loadMemberships).toHaveBeenCalledTimes(1)

    orgs.loadMemberships = vi.fn(async () => {
      throw new Error("redis down")
    })
    const res2 = await app.inject({ method: "GET", url: "/v1/anything", headers: { "x-user-id": USER } })
    expect(res2.statusCode).toBe(200)
    expect(res2.json().memberships).toEqual({ organizations: [], workspaces: [] })
  })

    /**
     * The concrete lockout: a platform admin who belongs to an organization,
     * with one of its workspaces selected, suspends that organization. Their
     * selection stops resolving on the very next request — and the page holding
     * the button that would undo it is behind an admin route.
     */
    it("is never refused for a selection that stopped resolving", async () => {
      const app = await buildApp()
      orgs.resolveRequestContext = vi.fn(async () => ({
        reject: { status: 403 as const, code: "not_a_member", message: "Not a member of that workspace" },
      }))
      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/orgs",
        headers: { "x-user-id": USER, "x-nodaro-workspace": WS },
      })
      expect(res.statusCode).toBe(200)
      // Nothing to resolve: these routes read across organizations by
      // definition, so a workspace means nothing to them.
      expect(orgs.resolveRequestContext).not.toHaveBeenCalled()
      expect(res.json().workspaceId).toBeNull()
      await app.close()
    })
})

describe("isPlatformAdminRoute", () => {
  it("covers the admin surface and nothing that merely looks like it", () => {
    expect(isPlatformAdminRoute("/v1/admin/orgs")).toBe(true)
    expect(isPlatformAdminRoute("/v1/admin/orgs/:id")).toBe(true)
    expect(isPlatformAdminRoute("/v1/admin/users/:id/storage")).toBe(true)
    expect(isPlatformAdminRoute("/v1/workflows/:id")).toBe(false)
    expect(isPlatformAdminRoute("/v1/adminx/orgs")).toBe(false)
    expect(isPlatformAdminRoute("/v1/orgs/:id/admin")).toBe(false)
    // No matched route means no pattern; resolving is then the safe default.
    expect(isPlatformAdminRoute(undefined)).toBe(false)
  })
})

describe("isIdentityRoute", () => {
  it("matches the route PATTERN, so no crafted path can pose as one", () => {
    expect(isIdentityRoute("GET", "/v1/me")).toBe(true)
    expect(isIdentityRoute("get", "/v1/me")).toBe(true)
    expect(isIdentityRoute("GET", "/v1/workspaces")).toBe(true)
    expect(isIdentityRoute("POST", "/v1/invitations/:token/accept")).toBe(true)
    // Public, so an invitee reads it signed out — but the SDK sends auth AND
    // its workspace on every request, and a caller with a stale selection is
    // exactly who needs this to answer.
    expect(isIdentityRoute("GET", "/v1/invitations/by-token/:token")).toBe(true)
    // Raw URLs are NOT patterns — these are what a crafted request would
    // present, and none of them may match.
    for (const url of [
      "/v1/invitations/abc/accept",
      "/v1/invitations//accept",
      "/v1/invitations/x/y/z/accept",
      "/v1/invitations/../workflows/123/accept",
      "/v1/me?x=1",
      "/v1/me/",
      "//v1/me",
    ]) {
      expect(isIdentityRoute("POST", url), `${url} must not match`).toBe(false)
    }
    // A request that matched no route has no pattern — the strict side.
    expect(isIdentityRoute("GET", undefined)).toBe(false)
    expect(isIdentityRoute("GET", "/v1/workspaces/:id")).toBe(false)
    expect(isIdentityRoute("GET", "/v1/me/archived-runs")).toBe(false)
    expect(isIdentityRoute("POST", "/v1/invitations/abc")).toBe(false)
    expect(isIdentityRoute("GET", "/v1/invitations/abc/accept")).toBe(false)
  })
})
