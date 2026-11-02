import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("contentRights resource", () => {
  it("declaration() GETs /v1/content-rights/declaration and unwraps data", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { version: 1, text: "I confirm…" } }))
    const out = await make(fetchMock).contentRights.declaration()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/content-rights/declaration")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual({ version: 1, text: "I confirm…" })
  })

  it("confirm() POSTs the link and the version, and answers the confirmation", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "c1", declarationVersion: 1, expiresAt: "2026-11-02T07:00:00Z" } }, 201))
    const out = await make(fetchMock).contentRights.confirm({ url: "https://youtu.be/x", declarationVersion: 1 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/content-rights/confirm")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ url: "https://youtu.be/x", declarationVersion: 1 })
    expect(out.id).toBe("c1")
  })

  it("media.downloadVideo() carries the confirmation id to the download", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ downloadId: "dl-1" }))
    await make(fetchMock).media.downloadVideo({ url: "https://youtu.be/x", confirmationId: "c1" })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ url: "https://youtu.be/x", confirmationId: "c1" })
  })
})
