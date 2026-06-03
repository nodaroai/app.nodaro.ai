import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  NodaroError,
  UnauthorizedError,
} from "../../index.js"
import type { UserIdentity } from "../../index.js"

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
