import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { Auth, SurfaceAvailability } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

const NO_TOKEN: Auth = { getToken: async () => null }

function client(fetchMock: ReturnType<typeof vi.fn>, auth: Auth = new StaticTokenAuth("t")) {
  return createClient({ baseUrl: "https://api.example.com", auth, fetch: fetchMock })
}

const ANSWER: SurfaceAvailability = {
  nodes: { denied: ["social-publish"], hiddenFromUsers: [] },
  models: { denied: ["flux-flex"] },
  webScrapeSources: { denied: [], hiddenFromUsers: [] },
  worlds: [
    { id: "app", enabled: true },
    { id: "image", enabled: true },
    { id: "voice", enabled: false },
  ],
}

describe("surface.availability()", () => {
  it("GETs /v1/surface/availability and returns the answer as sent, worlds in the deployment's order", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(ANSWER))
    expect(await client(fetchMock).surface.availability()).toEqual(ANSWER)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/surface/availability")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
  })

  it("asks signed out too (the answer is then a user's)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(ANSWER))
    expect((await client(fetchMock, NO_TOKEN).surface.availability()).worlds).toHaveLength(3)
  })

  it("keeps a world id this SDK does not know", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ ...ANSWER, worlds: [{ id: "a-newer-world", enabled: true }] }))
    expect((await client(fetchMock).surface.availability()).worlds).toEqual([{ id: "a-newer-world", enabled: true }])
  })
})
