import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("developerApps resource", () => {
  it("rotateSecret POSTs to /v1/developer-apps/:id/rotate-secret", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ clientSecret: "sec_abc123" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.developerApps.rotateSecret("app-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/developer-apps/app-1/rotate-secret",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(result.clientSecret).toBe("sec_abc123")
  })

  it("get throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "App not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.developerApps.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })
})
