import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("oauth resource", () => {
  it("exchangeCode POSTs to /v1/oauth/token with snake_case body + grant_type", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        access_token: "ndr_app_xyz",
        token_type: "Bearer",
        scope: "workflows:read",
        expires_in: 7776000,
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.oauth.exchangeCode({
      client_id: "app_abc",
      client_secret: "sec_xyz",
      code: "code_123",
      redirect_uri: "https://app.example.com/cb",
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/oauth/token")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      grant_type: "authorization_code",
      client_id: "app_abc",
      client_secret: "sec_xyz",
      code: "code_123",
      redirect_uri: "https://app.example.com/cb",
    })
  })

  it("exchangeCode surfaces 401 invalid_client as a NodaroError", async () => {
    // OAuth token endpoint returns OAuth-spec error envelopes (no nested `error.code`),
    // so the client's mapper falls through to the generic NodaroError on 401
    // since it can't read a meaningful code.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(401, { error: "invalid_client", error_description: "Bad client_secret" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.oauth.exchangeCode({
        client_id: "app_abc",
        client_secret: "wrong",
        code: "code_123",
        redirect_uri: "https://app.example.com/cb",
      }),
    ).rejects.toBeInstanceOf(NodaroError)
  })
})
