import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  NodaroError,
  InsufficientCreditsError,
  StorageExceededError,
} from "../../index.js"
import type { UserBalance } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const BALANCE: UserBalance = {
  total: 1500,
  subscription: 1000,
  topup: 500,
  dailySpent: 20,
  dailyLimit: null,
  monthlyAllocation: 1000,
  tier: "pro",
  features: { hd: true },
  periodEnd: "2026-07-01T00:00:00.000Z",
  appCreditsAllowance: 0,
}

describe("credits.transactions()", () => {
  const ROW = {
    id: "ul-1",
    created_at: "2026-10-13T20:00:00.000Z",
    credits_charged: 444,
    credits_reserved: 888,
    credits_used: 888,
    action: "seedance-2",
    provider: "kie",
    status: "committed",
    metadata: { model: "seedance-2" },
    payer: "user",
    workspaceId: null,
  }

  it("GETs /v1/credits/transactions and returns the page whole — rows and nextCursor", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [ROW], nextCursor: ROW.created_at }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const page = await c.credits.transactions()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/credits/transactions")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(page.nextCursor).toBe(ROW.created_at)
    expect(page.data[0]!.credits_charged).toBe(444)
    expect(page.data[0]!.credits_reserved).toBe(888)
  })

  it("passes limit and cursor as query parameters", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: null }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const page = await c.credits.transactions({ limit: 50, cursor: "2026-10-13T20:00:00.000Z" })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe("/v1/credits/transactions")
    expect(url.searchParams.get("limit")).toBe("50")
    expect(url.searchParams.get("cursor")).toBe("2026-10-13T20:00:00.000Z")
    expect(page).toEqual({ data: [], nextCursor: null })
  })
})

describe("credits resource", () => {
  it("balance() GETs /v1/user/credits and unwraps `data`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: BALANCE }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const balance = await c.credits.balance()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/user/credits")
    const init = fetchMock.mock.calls[0][1] as { method: string }
    expect(init.method).toBe("GET")
    expect(balance).toEqual(BALANCE)
    expect(balance.total).toBe(1500)
    expect(balance.tier).toBe("pro")
  })

  it("modelCosts() POSTs /v1/credits/model-costs with `{ models }` and returns the fault-isolation shape", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ data: { a: 12, b: 30 }, missing: ["c"], errors: ["d"] }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.credits.modelCosts(["a", "b", "c", "d"])

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/credits/model-costs")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    const sent = JSON.parse(init.body) as { models: string[] }
    expect(sent.models).toEqual(["a", "b", "c", "d"])

    expect(result.data).toEqual({ a: 12, b: 30 })
    expect(result.missing).toEqual(["c"])
    expect(result.errors).toEqual(["d"])
  })

  it("modelCosts() caps the request at 50 identifiers", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: {}, missing: [], errors: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const ids = Array.from({ length: 75 }, (_, i) => `m${i}`)
    await c.credits.modelCosts(ids)

    const init = fetchMock.mock.calls[0][1] as { body: string }
    const sent = JSON.parse(init.body) as { models: string[] }
    expect(sent.models).toHaveLength(50)
    expect(sent.models[0]).toBe("m0")
    expect(sent.models[49]).toBe("m49")
  })

  it("rejects with InsufficientCreditsError on 402 (carries required/available)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(402, { error: { code: "insufficient_credits", required: 100, available: 50 } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.credits.modelCosts(["a"])).rejects.toMatchObject({
      name: "InsufficientCreditsError",
      required: 100,
      available: 50,
    })
  })

  it("a 402 error is an instanceof both InsufficientCreditsError AND the NodaroError base (additive)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(402, { error: { code: "insufficient_credits", required: 100, available: 50 } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const err = await c.credits.balance().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).toBeInstanceOf(NodaroError)
  })

  it("rejects with StorageExceededError on 413 (carries limitBytes) and is also a NodaroError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(413, { error: { code: "storage_exceeded", limitBytes: 10_000_000 } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const err = await c.credits.modelCosts(["a"]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageExceededError)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as StorageExceededError).limitBytes).toBe(10_000_000)
  })
})
