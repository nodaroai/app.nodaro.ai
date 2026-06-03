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
