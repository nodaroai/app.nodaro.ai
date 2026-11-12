/**
 * The standalone orchestrator learns which house models this deployment
 * serves from this container's API. Anything but a 200 carrying a list of ids
 * throws, and the caller then holds the answer UNKNOWN — a run on a house
 * model is handed back, never refused for good (lib/house-models-served.ts).
 */
import { describe, it, expect, vi } from "vitest"
import { askApiHouseModelsServed } from "../house-models-served-loopback.js"

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe("askApiHouseModelsServed", () => {
  it("asks the internal route with the internal secret, and reads the ids", async () => {
    const fetchImpl = reply(200, { ids: ["a-house-model"] })
    expect(await askApiHouseModelsServed(fetchImpl as unknown as typeof fetch)).toEqual(["a-house-model"])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^http:\/\/localhost:\d+\/v1\/house-models\/internal\/served$/)
    expect((init.headers as Record<string, string>)["X-Internal-Orchestrator-Secret"]).toBeTypeOf("string")
  })

  it("an empty list is an answer", async () => {
    expect(await askApiHouseModelsServed(reply(200, { ids: [] }) as unknown as typeof fetch)).toEqual([])
  })

  it("throws on an error status or an answer that is not a list of ids", async () => {
    await expect(askApiHouseModelsServed(reply(403, { error: {} }) as unknown as typeof fetch)).rejects.toThrow()
    await expect(askApiHouseModelsServed(reply(200, { ids: "x" }) as unknown as typeof fetch)).rejects.toThrow()
    await expect(askApiHouseModelsServed(reply(200, { ids: [1] }) as unknown as typeof fetch)).rejects.toThrow()
  })
})
