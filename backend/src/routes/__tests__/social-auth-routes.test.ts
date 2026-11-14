import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { runInNewContext } from "node:vm"
import Fastify, { type FastifyInstance } from "fastify"

// ---- mocks -----------------------------------------------------------------
const upsertMock = vi.fn(async (_row: Record<string, unknown>, _opts?: unknown) => ({ error: null }))

/** Rows the mocked `social_connections` table holds for the current test. */
let connectionRows: ReadonlyArray<Record<string, unknown>> = []

/** Mirror PostgREST: `.select("a, b")` yields ONLY the listed columns. */
function projectColumns(row: Record<string, unknown>, cols?: string): Record<string, unknown> {
  if (!cols) return { ...row }
  const keys = cols.split(",").map((c) => c.trim()).filter(Boolean)
  return Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]))
}

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      upsert: upsertMock,
      // Column-faithful on purpose: a route that forgets a column in its select
      // list fails here exactly the way it fails in production — and one that
      // over-selects leaks the same secrets it would leak on the wire.
      select: (cols?: string) => ({
        eq: () => ({ data: connectionRows.map((r) => projectColumns(r, cols)), error: null }),
      }),
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
import { saveOAuthState, savePendingSelection } from "../../services/social/state-store.js"
import { getRedirectUri } from "../../services/social/oauth.js"
import { config } from "../../lib/config.js"
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
  connectionRows = []
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
describe("GET /v1/social/connections", () => {
  const row = {
    id: "conn-1",
    user_id: "user-1",
    platform: "facebook",
    platform_user_id: "p1",
    platform_username: "Page One",
    platform_avatar_url: null,
    display_name: "Page One",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    token_expires_at: null,
    scopes: ["pages_manage_posts"],
    reconnect_needed: true,
    access_token_encrypted: "enc-blob", // gitleaks:allow — fake fixture
  }

  it("passes reconnect_needed through so the UI can surface the Reconnect chip", async () => {
    connectionRows = [row]

    const r = await app.inject({ method: "GET", url: "/v1/social/connections" })
    expect(r.statusCode).toBe(200)
    const { connections } = r.json() as { connections: Array<Record<string, unknown>> }
    expect(connections).toHaveLength(1)
    // executePublish() maintains this flag for providers whose tokens can't
    // self-heal. Drop it from the select list and the card can no longer tell a
    // live connection from a dead one.
    expect(connections[0]!.reconnect_needed).toBe(true)
  })

  it("never ships the encrypted token to the client", async () => {
    connectionRows = [row]

    const r = await app.inject({ method: "GET", url: "/v1/social/connections" })
    expect((r.json() as { connections: Array<Record<string, unknown>> }).connections[0]!
      .access_token_encrypted).toBeUndefined()
  })
})

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

/**
 * The callback pages tell the app that opened the pop-up how the connect went,
 * with `postMessage`. Each post names one origin that may receive it: the
 * origin of the redirect URI the provider sent the pop-up to (the app's own
 * origin on a one-host deployment), and the app's own host too when the
 * deployment gives its pages one. Never `*`, and never whatever host the page
 * happened to be reached on. Each page's script is run against a stand-in browser here, so
 * the test reads what the page really sends rather than its source text.
 */
describe("the OAuth callback pages post their result only to configured origins", () => {
  /** Where the page is served in the stand-in browser: deliberately NOT the configured origin. */
  const SERVED_ON = "https://another-host.example"
  const expectedTarget = () => new URL(getRedirectUri("tiktok")).origin

  interface Posted {
    message: unknown
    targetOrigin: unknown
  }

  /**
   * Run the page's one inline script with an opener that records what it is
   * sent. For the account picker, `finalize` is what POST /connect/finalize
   * answers, and every account button is clicked.
   */
  async function runPageScript(html: string, finalize?: unknown): Promise<Posted[]> {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!)
    expect(scripts).toHaveLength(1)

    const posted: Posted[] = []
    const clicks: Array<() => Promise<void>> = []
    const button = {
      dataset: { id: "p2" },
      setAttribute() {},
      removeAttribute() {},
      addEventListener(_type: string, handler: () => Promise<void>) {
        clicks.push(handler)
      },
    }
    runInNewContext(scripts[0]!, {
      window: {
        opener: {
          postMessage(message: unknown, targetOrigin: unknown) {
            posted.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin })
          },
        },
        location: { origin: SERVED_ON },
        close() {},
      },
      document: {
        querySelectorAll: () => [button],
        getElementById: () => ({ textContent: "", hidden: true }),
        body: { innerHTML: "" },
      },
      setTimeout: () => 0,
      fetch: async () => ({ ok: true, json: async () => finalize }),
    })
    for (const click of clicks) await click()
    return posted
  }

  /** The provider's token endpoint, answering with `body` and `status`. */
  function stubTokenEndpoint(body: string, status = 200) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }))
  }

  it("the denied page posts its error to the redirect URI's origin", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?error=access_denied" })
    expect(r.statusCode).toBe(200)

    const posted = await runPageScript(r.body)
    expect(posted).toEqual([
      { message: { type: "social-auth-error", message: "Authorization was denied or failed." }, targetOrigin: expectedTarget() },
    ])
    expect(posted[0]!.targetOrigin).not.toBe("*")
  })

  it("the success page posts to the redirect URI's origin", async () => {
    process.env.TIKTOK_CLIENT_KEY = "ck"
    process.env.TIKTOK_CLIENT_SECRET = "cs"
    await saveOAuthState("state-ok", { providerId: "tiktok", userId: "user-1", codeVerifier: "verifier" })
    const token = stubTokenEndpoint(JSON.stringify({ access_token: "at" }))
    const userInfo = vi.spyOn(getProvider("tiktok")!, "fetchUserInfo").mockResolvedValue({ id: "tt-1", username: "me" })

    try {
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/tiktok?code=c&state=state-ok" })
      expect(r.body).toContain("Connected to tiktok!")

      const posted = await runPageScript(r.body)
      expect(posted).toEqual([{ message: { type: "social-auth-success", platform: "tiktok" }, targetOrigin: expectedTarget() }])
    } finally {
      token.mockRestore()
      userInfo.mockRestore()
    }
  })

  it("the account picker posts to the redirect URI's origin once an account is chosen", async () => {
    process.env.META_APP_ID = "app"
    process.env.META_APP_SECRET = "secret"
    await saveOAuthState("state-fb", { providerId: "facebook", userId: "user-1" })
    const token = stubTokenEndpoint(JSON.stringify({ access_token: "fb-user-token" }))
    const accounts = vi.spyOn(getProvider("facebook")!, "listAccounts").mockResolvedValue([
      { id: "p1", name: "Page One" },
      { id: "p2", name: "Page Two" },
    ])

    try {
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?code=c&state=state-fb" })
      expect(r.body).toContain("Choose an account")

      const posted = await runPageScript(r.body, { success: true, platform: "facebook", username: "Page Two" })
      expect(posted).toEqual([{ message: { type: "social-auth-success", platform: "facebook" }, targetOrigin: expectedTarget() }])
    } finally {
      token.mockRestore()
      accounts.mockRestore()
    }
  })

  it("an error text from the provider cannot break out of the page's script", async () => {
    process.env.TIKTOK_CLIENT_KEY = "ck"
    process.env.TIKTOK_CLIENT_SECRET = "cs"
    await saveOAuthState("state-err", { providerId: "tiktok", userId: "user-1", codeVerifier: "verifier" })
    const providerText = '</script><script>window.opener.postMessage({type:"social-auth-success",platform:"tiktok"},"*")</script>'
    const token = stubTokenEndpoint(providerText, 400)

    try {
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/tiktok?code=c&state=state-err" })
      // One script block, closed once: the provider's text stayed inside its string.
      expect(r.body.match(/<\/script/gi)).toHaveLength(1)

      const posted = await runPageScript(r.body)
      expect(posted).toEqual([
        {
          message: { type: "social-auth-error", message: `Token exchange failed for tiktok: ${providerText}` },
          targetOrigin: expectedTarget(),
        },
      ])
    } finally {
      token.mockRestore()
    }
  })
  describe("the app's own host, when it has one", () => {
    const FLOW = "https://flow.example.test"
    // A running server with a Flow origin always has a kept origin (PUBLIC_URL), plus a legacy host when the move is on (any other set is refused at boot).
    const MOVE = { LEGACY_UI_HOSTS: "app.example.test", PUBLIC_URL: "https://app.example.test" }
    let before: { LEGACY_UI_HOSTS?: string; PUBLIC_URL?: string }
    beforeEach(() => {
      before = { LEGACY_UI_HOSTS: (config as { LEGACY_UI_HOSTS?: string }).LEGACY_UI_HOSTS, PUBLIC_URL: config.PUBLIC_URL }
      Object.assign(config, MOVE)
    })
    afterEach(() => {
      delete (config as { FLOW_PUBLIC_URL?: string }).FLOW_PUBLIC_URL
      delete (config as { FLOW_UI_ORIGIN?: string }).FLOW_UI_ORIGIN
      Object.assign(config, before)
    })

    it("the pages' own host without the move (no legacy host): posts to both origins, since a page on either may have opened the connect", async () => {
      ;(config as { FLOW_UI_ORIGIN?: string }).FLOW_UI_ORIGIN = FLOW
      ;(config as { LEGACY_UI_HOSTS?: string }).LEGACY_UI_HOSTS = ""
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?error=access_denied" })
      const posted = await runPageScript(r.body)
      expect(posted.map((p) => p.targetOrigin).sort()).toEqual([FLOW, expectedTarget()].sort())
      expect(posted.every((p) => p.targetOrigin !== "*")).toBe(true)
    })

    it("posts once per origin, each naming its own exact target, never \"*\"", async () => {
      ;(config as { FLOW_PUBLIC_URL?: string }).FLOW_PUBLIC_URL = `${FLOW}/`
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?error=access_denied" })
      expect(r.statusCode).toBe(200)
      const posted = await runPageScript(r.body)
      expect(posted.map((p) => p.targetOrigin).sort()).toEqual([FLOW, expectedTarget()].sort())
      expect(posted.every((p) => p.targetOrigin !== "*")).toBe(true)
    })

    it("FLOW_UI_ORIGIN alone names the same host: one origin, whichever name gives it", async () => {
      ;(config as { FLOW_UI_ORIGIN?: string }).FLOW_UI_ORIGIN = FLOW
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?error=access_denied" })
      const posted = await runPageScript(r.body)
      expect(posted.map((p) => p.targetOrigin).sort()).toEqual([FLOW, expectedTarget()].sort())
    })

    it("with no such host, the page posts exactly as before: one post, to the callback origin", async () => {
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?error=access_denied" })
      const posted = await runPageScript(r.body)
      expect(posted.map((p) => p.targetOrigin)).toEqual([expectedTarget()])
    })
  })
})

describe("the account picker shows the chosen account's name as text", () => {
  it("never parses the name the network returns as HTML", async () => {
    process.env.META_APP_ID = "app"
    process.env.META_APP_SECRET = "secret"
    await saveOAuthState("state-name", { providerId: "facebook", userId: "user-1" })
    const token = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fb-user-token" }), { status: 200 }),
    )
    const accounts = vi.spyOn(getProvider("facebook")!, "listAccounts").mockResolvedValue([
      { id: "p1", name: "Page One" },
      { id: "p2", name: "Page Two" },
    ])

    try {
      const r = await app.inject({ method: "GET", url: "/v1/social/callback/facebook?code=c&state=state-name" })
      const script = /<script>([\s\S]*?)<\/script>/i.exec(r.body)![1]!

      // A page name is whatever the page's admins typed.
      const name = '<img src=x onerror="alert(1)">'
      const html: string[] = []
      const text: string[] = []
      const element = () => ({
        set textContent(v: string) {
          text.push(v)
        },
        hidden: true,
      })
      let onClick: (() => Promise<void>) | undefined
      runInNewContext(script, {
        window: { opener: { postMessage() {} }, location: { origin: "https://another-host.example" }, close() {} },
        document: {
          querySelectorAll: () => [
            {
              dataset: { id: "p2" },
              setAttribute() {},
              removeAttribute() {},
              addEventListener(_t: string, h: () => Promise<void>) {
                onClick = h
              },
            },
          ],
          getElementById: element,
          querySelector: element,
          body: {
            set innerHTML(v: string) {
              html.push(v)
            },
            querySelector: element,
          },
        },
        setTimeout: () => 0,
        fetch: async () => ({ ok: true, json: async () => ({ success: true, platform: "facebook", username: name }) }),
      })
      await onClick!()

      expect(html.join("")).not.toContain("<img")
      expect(text.join("")).toContain(name)
    } finally {
      token.mockRestore()
      accounts.mockRestore()
    }
  })
})
