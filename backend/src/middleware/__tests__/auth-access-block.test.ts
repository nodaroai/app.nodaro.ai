import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

/**
 * A blocked account, at the auth hook (`registerAuthHook`).
 *
 * The block is checked ONCE, after the credential is resolved, so every way in
 * that resolves to the account is refused — a fresh session, a cached one, a
 * personal API token, a connected app's token — on public routes too when a
 * credential is presented. Two things are deliberately NOT refused:
 *  - internal-secret calls, which settle work already in flight (new work for a
 *    blocked account is refused where it starts: job insert, reservation,
 *    trigger lanes);
 *  - a dynamically registered client (an MCP connector) whose recorded "owner"
 *    is only its first consenting user — blocking that one person must not stop
 *    the connector for everyone else. A developer's OWN app (`kind: "user"`)
 *    does stop with its developer, for every user's token.
 *
 * Assertions are handler-level: every refusal also proves the route handler
 * never ran — a 403 produced after the handler did its work would satisfy a
 * status check and still be the bug.
 */

const BLOCKED = "00000000-0000-4000-8000-0000000000b1"
const USER = "00000000-0000-4000-8000-0000000000a1"
const DEVELOPER = "00000000-0000-4000-8000-0000000000d1"

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const tables = new Map<string, Result>()
  const writes: Array<{ table: string; op: string; payload: unknown }> = []
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const result = (): Result => tables.get(table) ?? { data: null, error: null }
    chain.select = () => chain
    chain.eq = () => chain
    chain.update = (payload: unknown) => {
      writes.push({ table, op: "update", payload })
      return chain
    }
    chain.single = async () => result()
    chain.maybeSingle = async () => result()
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
    return chain
  }
  const blocked = new Set<string>()
  return {
    tables,
    writes,
    blocked,
    from: vi.fn((table: string) => chainFor(table)),
    getUser: vi.fn(),
    isUserBlocked: vi.fn(async (id: string | null | undefined) => (id ? blocked.has(id) : false)),
  }
})

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: h.from,
    auth: { getUser: (...a: unknown[]) => h.getUser(...a) },
  },
}))

vi.mock("../../lib/admin-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/admin-check.js")>()),
  warmAdminCache: vi.fn(),
}))

vi.mock("../../lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: (id: string | null | undefined) => h.isUserBlocked(id),
}))

import { registerAuthHook } from "../auth.js"
import { ACCESS_BLOCKED_BODY } from "../../lib/access-blocks.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const INTERNAL_SECRET = process.env.INTERNAL_ORCHESTRATOR_SECRET as string
const REAL_PROFILE = process.env.NODARO_SURFACE_PROFILE

let app: FastifyInstance
const probe = vi.fn(async (req: FastifyRequest) => ({ userId: req.userId ?? null, authKind: req.authKind ?? null }))
const publicProbe = vi.fn(async (req: FastifyRequest) => ({ userId: req.userId ?? null }))
const mcpProbe = vi.fn(async (req: FastifyRequest) => ({ userId: req.userId ?? null }))

beforeAll(async () => {
  // No surface profile: the SSO gate and the billing-key lane stay inert.
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  registerAuthHook(app)
  app.get("/v1/probe", probe)
  app.post("/v1/probe", probe)
  app.get("/v1/gallery", publicProbe) // a PUBLIC route
  app.post("/mcp", mcpProbe) // public, checks its bearer itself
  await app.ready()
})

afterAll(async () => {
  await app.close()
  if (REAL_PROFILE === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_PROFILE
  __resetSurfaceProfileCacheForTests()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.tables.clear()
  h.writes.length = 0
  h.blocked.clear()
  h.blocked.add(BLOCKED)
  h.tables.set("profiles", { data: { role: null }, error: null })
})

/** The auth cache is module-level and keyed by token: every test gets its own. */
let seq = 0
function jwt(): string {
  seq += 1
  return `eyJhbGciOiJIUzI1NiJ9.test-${seq}-${Date.now()}.sig`
}

function sessionOf(userId: string): void {
  h.getUser.mockResolvedValue({ data: { user: { id: userId, app_metadata: {}, user_metadata: {} } }, error: null })
}

function get(url: string, token: string) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe("a browser session (JWT)", () => {
  it("of a blocked account is refused 403 access_blocked, and no handler runs", async () => {
    sessionOf(BLOCKED)
    const res = await get("/v1/probe", jwt())
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(probe).not.toHaveBeenCalled()
  })

  it("of an account that is not blocked passes", async () => {
    sessionOf(USER)
    const res = await get("/v1/probe", jwt())
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: USER, authKind: "jwt" })
    expect(h.isUserBlocked).toHaveBeenCalledWith(USER)
  })

  it("is refused from the CACHE too — a block lands on a session that was already verified", async () => {
    sessionOf(USER)
    const token = jwt()
    expect((await get("/v1/probe", token)).statusCode).toBe(200)

    h.blocked.add(USER) // the admin blocks the account mid-session
    const res = await get("/v1/probe", token)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(h.getUser).toHaveBeenCalledTimes(1) // the second request was answered from the cache
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("is refused on a PUBLIC route when it presents its session; the route stays public without one", async () => {
    sessionOf(BLOCKED)
    const refused = await get("/v1/gallery", jwt())
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(publicProbe).not.toHaveBeenCalled()

    const anonymous = await app.inject({ method: "GET", url: "/v1/gallery" })
    expect(anonymous.statusCode).toBe(200)
    expect(anonymous.json()).toEqual({ userId: null })
  })
})

describe("a sign-in GoTrue refuses as banned (user_banned)", () => {
  // A blocked account is also banned from signing in, so an uncached session
  // fails in getUser before its id is known. It gets the block's answer, not a
  // 401 that would send the browser to a login page that refuses it again.
  function banned(): void {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { code: "user_banned", message: "User is banned" } })
  }

  it("answers 403 access_blocked on a protected route", async () => {
    banned()
    const res = await get("/v1/probe", jwt())
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(probe).not.toHaveBeenCalled()
  })

  it("answers 403 access_blocked on a public route too", async () => {
    banned()
    const res = await get("/v1/gallery", jwt())
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(publicProbe).not.toHaveBeenCalled()
  })

  it("only that code: an ordinary invalid token is still a 401, and anonymous on a public route", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { code: "bad_jwt", message: "invalid JWT" } })
    expect((await get("/v1/probe", jwt())).statusCode).toBe(401)
    const pub = await get("/v1/gallery", jwt())
    expect(pub.statusCode).toBe(200)
    expect(pub.json()).toEqual({ userId: null })
  })
})

// ---------------------------------------------------------------------------
// Internal calls
// ---------------------------------------------------------------------------

describe("an internal-secret call", () => {
  it("for a blocked account still passes — it settles work already in flight", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/probe",
      headers: { "x-internal-orchestrator-secret": INTERNAL_SECRET },
      payload: { userId: BLOCKED },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: BLOCKED, authKind: "internal" })
    expect(h.isUserBlocked).not.toHaveBeenCalled()
  })

  it("…the header form for bodyless methods too", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/probe",
      headers: { "x-internal-orchestrator-secret": INTERNAL_SECRET, "x-internal-user-id": BLOCKED },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: BLOCKED, authKind: "internal" })
  })
})

// ---------------------------------------------------------------------------
// Personal API tokens
// ---------------------------------------------------------------------------

describe("a personal API token (ndr_)", () => {
  function apiTokenOf(userId: string): string {
    seq += 1
    h.tables.set("api_tokens", {
      data: {
        id: `tok-${seq}`,
        user_id: userId,
        workflow_ids: [],
        rate_limit: 30,
        token_hash: "h",
        is_active: true,
        workspace_id: null,
      },
      error: null,
    })
    return `ndr_${String(seq).padStart(64, "0")}`
  }

  it("of a blocked account is refused 403 access_blocked", async () => {
    const res = await get("/v1/probe", apiTokenOf(BLOCKED))
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(probe).not.toHaveBeenCalled()
  })

  it("of an account that is not blocked passes", async () => {
    const res = await get("/v1/probe", apiTokenOf(USER))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: USER, authKind: "api_token" })
  })
})

// ---------------------------------------------------------------------------
// Connected apps
// ---------------------------------------------------------------------------

describe("a connected app's token (ndr_app_)", () => {
  function appToken(app: { kind: string | null; owner: string | null }, user = USER): string {
    h.tables.set("developer_app_tokens", {
      data: {
        id: "token-row-1",
        authorization_id: "authz-1",
        expires_at: null,
        revoked_at: null,
        developer_app_authorizations: {
          id: "authz-1",
          app_id: "app-1",
          user_id: user,
          scopes_granted: ["workflows:read"],
          revoked_at: null,
          monthly_spend_cap_credits: null,
          developer_apps: { kind: app.kind, owner_user_id: app.owner },
        },
      },
      error: null,
    })
    seq += 1
    return `ndr_app_${String(seq).padStart(64, "0")}`
  }

  const touches = () => h.writes.filter((w) => w.table === "developer_app_tokens" && w.op === "update")

  it("stops for EVERY user when the developer's own app (kind user) belongs to a blocked developer", async () => {
    const res = await get("/v1/probe", appToken({ kind: "user", owner: BLOCKED }))
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(probe).not.toHaveBeenCalled()
    // Refused before it counts as used.
    expect(touches()).toHaveLength(0)
  })

  it("an app with no recorded kind is a developer's own app", async () => {
    const res = await get("/v1/probe", appToken({ kind: null, owner: BLOCKED }))
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
  })

  it("stops on /mcp too — public, but where connector tokens are actually used", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${appToken({ kind: "user", owner: BLOCKED })}` },
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(mcpProbe).not.toHaveBeenCalled()
  })

  it.each(["dynamic_mcp", "community_instance"])(
    "a %s client is NOT stopped by its recorded owner's block",
    async (kind) => {
      const res = await get("/v1/probe", appToken({ kind, owner: BLOCKED }))
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ userId: USER, authKind: "app_token" })
      // The recorded owner is not even asked about.
      expect(h.isUserBlocked).not.toHaveBeenCalledWith(BLOCKED)
      expect(touches()).toHaveLength(1)
    },
  )

  it("is refused when the token's OWN account is blocked, whoever owns the app", async () => {
    const res = await get("/v1/probe", appToken({ kind: "user", owner: DEVELOPER }, BLOCKED))
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(ACCESS_BLOCKED_BODY)
    expect(probe).not.toHaveBeenCalled()
  })

  it("passes when neither the account nor the developer is blocked", async () => {
    const res = await get("/v1/probe", appToken({ kind: "user", owner: DEVELOPER }))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: USER, authKind: "app_token" })
    expect(h.isUserBlocked).toHaveBeenCalledWith(DEVELOPER)
    expect(h.isUserBlocked).toHaveBeenCalledWith(USER)
  })
})
