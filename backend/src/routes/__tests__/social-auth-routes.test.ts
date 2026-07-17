import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---- mocks -----------------------------------------------------------------
const upsertMock = vi.fn(async (_row: Record<string, unknown>, _opts?: unknown) => ({ error: null }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      upsert: upsertMock,
      select: () => ({ eq: () => ({ data: [], error: null }) }),
    }),
  },
}))

const redisStore = new Map<string, string>()
vi.mock("../../lib/queue.js", () => ({
  redis: {
    async set(key: string, val: string) {
      redisStore.set(key, val)
      return "OK"
    },
    multi() {
      const ops: Array<() => unknown> = []
      const chain = {
        get(key: string) {
          ops.push(() => redisStore.get(key) ?? null)
          return chain
        },
        del(key: string) {
          ops.push(() => (redisStore.delete(key) ? 1 : 0))
          return chain
        },
        async exec() {
          return ops.map((f) => [null, f()] as [null, unknown])
        },
      }
      return chain
    },
  },
}))

import { socialAuthRoutes } from "../social-auth.js"
import { savePendingSelection } from "../../services/social/state-store.js"
import { encryptToken } from "../../services/social/encryption.js"
import { getProvider } from "../../services/social/providers/registry.js"

// ---- env scaffolding -------------------------------------------------------
const ENV_KEYS = [
  "SOCIAL_ENCRYPTION_KEY",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
] as const
const savedEnv: Record<string, string | undefined> = {}

let app: FastifyInstance
beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.SOCIAL_ENCRYPTION_KEY = "a".repeat(64)
  redisStore.clear()
  upsertMock.mockClear()

  app = Fastify({ logger: false })
  // Simulate the auth hook having resolved a user.
  app.addHook("onRequest", async (req) => {
    ;(req as { userId?: string }).userId = "user-1"
  })
  await app.register(socialAuthRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

// ---- tests -----------------------------------------------------------------
describe("GET /v1/social/providers", () => {
  it("returns every registered provider with availability flags", async () => {
    delete process.env.TIKTOK_CLIENT_KEY
    delete process.env.TIKTOK_CLIENT_SECRET

    const r = await app.inject({ method: "GET", url: "/v1/social/providers" })
    expect(r.statusCode).toBe(200)
    const { providers } = r.json() as { providers: Array<Record<string, unknown>> }
    expect(providers.length).toBeGreaterThanOrEqual(7)

    const tiktok = providers.find((p) => p.id === "tiktok")!
    expect(tiktok.available).toBe(false)
    expect(tiktok.missingEnv).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"])

    const telegram = providers.find((p) => p.id === "telegram")!
    expect(telegram.available).toBe(true)
    expect(telegram.connectKind).toBe("bot_token")
  })
})

describe("GET /v1/social/auth-url", () => {
  it("400s with the missing env names for an unconfigured provider", async () => {
    delete process.env.TIKTOK_CLIENT_KEY
    delete process.env.TIKTOK_CLIENT_SECRET

    const r = await app.inject({ method: "GET", url: "/v1/social/auth-url?platform=tiktok" })
    expect(r.statusCode).toBe(400)
    const body = r.json() as { error: { code: string; missingEnv: string[] } }
    expect(body.error.code).toBe("provider_not_configured")
    expect(body.error.missingEnv).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"])
  })

  it("issues an auth url + persists state in Redis when configured", async () => {
    process.env.TIKTOK_CLIENT_KEY = "ck"
    process.env.TIKTOK_CLIENT_SECRET = "cs"

    const r = await app.inject({ method: "GET", url: "/v1/social/auth-url?platform=tiktok" })
    expect(r.statusCode).toBe(200)
    const { url } = r.json() as { url: string }
    // TikTok quirk preserved: client_key, not client_id.
    expect(url).toContain("client_key=ck")
    expect(url).not.toContain("client_id=")
    expect(url).toContain("code_challenge_method=S256")

    const state = new URL(url).searchParams.get("state")!
    expect(redisStore.has(`social:state:${state}`)).toBe(true)
  })

  it("rejects unknown platforms and bot_token platforms", async () => {
    const bad = await app.inject({ method: "GET", url: "/v1/social/auth-url?platform=postiz" })
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { error: { code: string } }).error.code).toBe("invalid_platform")

    const tg = await app.inject({ method: "GET", url: "/v1/social/auth-url?platform=telegram" })
    expect(tg.statusCode).toBe(400)
  })
})

describe("POST /v1/social/connect/finalize (between-steps picker)", () => {
  it("finalizes the CHOSEN account — not the first one", async () => {
    process.env.META_APP_ID = "app"
    process.env.META_APP_SECRET = "secret"

    // The provider resolves the chosen id; stub finalizeAccount to observe it.
    const fb = getProvider("facebook")!
    const spy = vi.spyOn(fb, "finalizeAccount").mockResolvedValue({
      id: "p2",
      username: "Page Two",
      metadata: { page_id: "p2" },
    })

    await savePendingSelection("tok-abc-123-def-456", {
      providerId: "facebook",
      userId: "user-1",
      accessTokenEncrypted: encryptToken("fb-user-token"),
      accounts: [
        { id: "p1", name: "Page One", rootId: "root-9" },
        { id: "p2", name: "Page Two", rootId: "root-9" },
      ],
    })

    const r = await app.inject({
      method: "POST",
      url: "/v1/social/connect/finalize",
      payload: { token: "tok-abc-123-def-456", accountId: "p2" }, // gitleaks:allow — fake fixture
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ success: true, platform: "facebook", username: "Page Two" })
    expect(spy).toHaveBeenCalledWith("fb-user-token", "p2")

    // Connection row wrote the picked account + the root grouping id.
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const row = upsertMock.mock.calls[0]![0]
    expect(row.platform_user_id).toBe("p2")
    expect(row.root_internal_id).toBe("root-9")
    expect(row.user_id).toBe("user-1")

    spy.mockRestore()
  })

  it("rejects an accountId outside the pending list", async () => {
    await savePendingSelection("tok-xyz-123-abc-999", {
      providerId: "facebook",
      userId: "user-1",
      accessTokenEncrypted: encryptToken("t"),
      accounts: [{ id: "p1", name: "Page One" }],
    })

    const r = await app.inject({
      method: "POST",
      url: "/v1/social/connect/finalize",
      payload: { token: "tok-xyz-123-abc-999", accountId: "evil" }, // gitleaks:allow — fake fixture
    })
    expect(r.statusCode).toBe(400)
    expect((r.json() as { error: { code: string } }).error.code).toBe("invalid_account")
  })

  it("rejects expired/unknown tokens (one-time consume)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/social/connect/finalize",
      payload: { token: "never-existed-token", accountId: "p1" },
    })
    expect(r.statusCode).toBe(400)
    expect((r.json() as { error: { code: string } }).error.code).toBe("expired")
  })
})
