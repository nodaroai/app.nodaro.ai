import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  NodaroError,
  NotFoundError,
  UnauthorizedError,
} from "../../index.js"
import type { ConnectedApp, UserIdentity } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const IDENTITY: UserIdentity = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  avatarUrl: "https://cdn.example.com/ada.png",
  tier: "pro",
  isAdmin: false,
}

describe("me() identity", () => {
  it("GETs /v1/me and unwraps `data` → UserIdentity", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: IDENTITY }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const me = await c.me()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/me")
    const init = fetchMock.mock.calls[0][1] as { method: string }
    expect(init.method).toBe("GET")
    expect(me).toEqual(IDENTITY)
    expect(me.tier).toBe("pro")
    expect(me.displayName).toBe("Ada Lovelace")
  })

  it("rejects with UnauthorizedError (also a NodaroError) on 401", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(401, { error: { code: "unauthorized", message: "Authentication required" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const err = await c.me().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(err).toBeInstanceOf(NodaroError)
  })
})

const APP: ConnectedApp = {
  authorizationId: "00000000-0000-4000-8000-0000000000a1",
  name: "Claude",
  kind: "dynamic_mcp",
  homepageUrl: null,
  scopes: ["workflows:read", "jobs:read"],
  connectedAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt: "2026-10-14T08:30:00.000Z",
}

function clientWith(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("session-jwt"), fetch: fetchMock })
}

describe("connected apps (browser session only)", () => {
  it("connectedApps() GETs /v1/me/connected-apps and returns the `apps` array", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ apps: [APP] }))
    const apps = await clientWith(fetchMock).connectedApps()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/me/connected-apps")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(apps).toEqual([APP])
  })

  it("connectedApps() returns [] when the account has none", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ apps: [] }))
    expect(await clientWith(fetchMock).connectedApps()).toEqual([])
  })

  it("revokeConnectedApp() POSTs …/:authorizationId/revoke (id url-encoded) and resolves to nothing", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ ok: true }))
    const result = await clientWith(fetchMock).revokeConnectedApp("a/b c")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/me/connected-apps/a%2Fb%20c/revoke")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST")
    expect(result).toBeUndefined()
  })

  it("an API key or app token is refused: UnauthorizedError carrying the route's message", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(401, { error: { code: "unauthorized", message: "Sign in required" } }),
    )
    const err = await clientWith(fetchMock).connectedApps().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect((err as Error).message).toBe("Sign in required")
  })

  it("revoking a grant that is not the caller's, or is already revoked, is a NotFoundError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Connected app not found" } }),
    )
    const err = await clientWith(fetchMock).revokeConnectedApp(APP.authorizationId).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect((err as Error).message).toBe("Connected app not found")
  })
})
