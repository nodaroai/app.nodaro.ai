/**
 * The standalone orchestrator learns whether the plugin charges Edit Plan per
 * started minute (decided 2026-10-07) from this container's API. Anything but
 * a 200 carrying a boolean `perMinute` throws, and the caller then fails
 * closed to the steps (lib/private-plugins/edit-plan-per-minute.ts).
 */
import { describe, it, expect, vi } from "vitest"
import { askApiEditPlanPerMinute } from "../edit-plan-per-minute-loopback.js"

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe("askApiEditPlanPerMinute", () => {
  it("asks the capabilities route with the internal secret, and reads perMinute", async () => {
    const fetchImpl = reply(200, { modes: ["tighten"], source: "server", perMinute: true })
    expect(await askApiEditPlanPerMinute(fetchImpl as unknown as typeof fetch)).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^http:\/\/localhost:\d+\/v1\/edit-plan\/capabilities$/)
    expect((init.headers as Record<string, string>)["X-Internal-Orchestrator-Secret"]).toBeTypeOf("string")
  })

  it("false when the API says so", async () => {
    expect(await askApiEditPlanPerMinute(reply(200, { modes: [], perMinute: false }) as unknown as typeof fetch)).toBe(false)
  })

  it("throws on an error status or an answer without perMinute (an API that predates it)", async () => {
    await expect(askApiEditPlanPerMinute(reply(500, {}) as unknown as typeof fetch)).rejects.toThrow()
    await expect(askApiEditPlanPerMinute(reply(200, { modes: ["tighten"] }) as unknown as typeof fetch)).rejects.toThrow()
  })
})
