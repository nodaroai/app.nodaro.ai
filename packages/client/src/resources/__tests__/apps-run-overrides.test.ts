import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

describe("apps.run inputOverrides", () => {
  it("sends nested inputOverrides next to the flat inputs", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ executionId: "e1", status: "pending" }))
    await client(fetchMock).apps.run("my-app", { prompt: "a cat" }, { inputOverrides: { n1: { promptPrefix: "PRE" } } })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({ inputs: { prompt: "a cat" }, inputOverrides: { n1: { promptPrefix: "PRE" } } })
  })
  it("omits inputOverrides when not given (unchanged wire shape)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ executionId: "e1", status: "pending" }))
    await client(fetchMock).apps.run("my-app", { prompt: "a cat" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({ inputs: { prompt: "a cat" } })
  })
})
