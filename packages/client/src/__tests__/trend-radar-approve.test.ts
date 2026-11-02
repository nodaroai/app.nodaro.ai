import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("trendRadar.approve", () => {
  it("POSTs the admin's confirmation for the top post's clip when given one, and an empty body otherwise", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { trendId: "t-1", clip: "attaching" } })).mockReturnValueOnce(mockOk({ data: { trendId: "t-1", clip: "none" } }))
    const out = await client(fetchMock).trendRadar.approve("c1", { confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01" })
    expect(out).toEqual({ trendId: "t-1", clip: "attaching" })
    expect((fetchMock.mock.calls[0][0] as string).endsWith("/v1/trend-radar/candidates/c1/approve")).toBe(true)
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01" })
    await client(fetchMock).trendRadar.approve("c1")
    expect(JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)).toEqual({})
  })
})
