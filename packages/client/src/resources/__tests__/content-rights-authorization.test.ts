/**
 * The standing authorization on the SDK: read, give and revoke it through
 * `/v1/content-rights/authorization`, and the refusal code a key's import
 * without one answers.
 */
import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, IMPORT_REFUSAL_CODES, ImportRefusedError } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("contentRights standing authorization", () => {
  it("authorization() GETs it and answers null when there is none", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: null }))
    expect(await make(fetchMock).contentRights.authorization()).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/content-rights/authorization")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")

    const given = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "a1", declarationVersion: 1, createdAt: "2026-11-02T07:00:00Z" } }))
    expect(await make(given).contentRights.authorization()).toEqual({ id: "a1", declarationVersion: 1, createdAt: "2026-11-02T07:00:00Z" })
  })

  it("authorize() POSTs the version and answers the authorization", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "a1", declarationVersion: 2, createdAt: "2026-11-02T07:00:00Z" } }, 201))
    const out = await make(fetchMock).contentRights.authorize({ declarationVersion: 2 })
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/content-rights/authorization")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ declarationVersion: 2 })
    expect(out.id).toBe("a1")
  })

  it("revokeAuthorization() DELETEs it", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { revoked: true } }))
    expect(await make(fetchMock).contentRights.revokeAuthorization()).toEqual({ revoked: true })
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("DELETE")
  })

  it("a key's import refused for want of an authorization is an ImportRefusedError with that code", async () => {
    expect(IMPORT_REFUSAL_CODES.has("rights_authorization_required")).toBe(true)
    const body = { error: { code: "rights_authorization_required", message: "Authorize imports through API keys and agents in Settings." } }
    const fetchMock = vi.fn().mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 403, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response),
    )
    const err = await make(fetchMock).media.downloadVideo({ url: "https://youtu.be/x" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImportRefusedError)
    expect((err as ImportRefusedError).code).toBe("rights_authorization_required")
  })
})
