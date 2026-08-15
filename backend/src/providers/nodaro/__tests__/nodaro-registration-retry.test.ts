/**
 * Boot-time registration of the nodaro.ai cloud provider must survive the
 * community stack's boot order. The worker reads the connection through the
 * container's OWN Caddy (SUPABASE_URL = localhost:3000/supabase), and
 * start.sh brings Caddy up only after the API answers /health — so the very
 * first read fails deterministically ("fetch failed", 2026-08-16 timeline:
 * read at +7s, Caddy serving at +8.3s). A single fire-and-forget attempt
 * therefore left the provider unregistered on EVERY boot; only the router's
 * one-shot self-heal on the first job hid it.
 *
 * Separate file on purpose: the registry is a per-file singleton with no
 * unregister, so the "does not register" cases run first and the one that
 * registers for real runs last.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockState, mockIsConnected } = vi.hoisted(() => ({
  mockState: vi.fn<() => Promise<{ state: "connected" | "not-connected" | "unavailable"; reason?: string }>>(),
  mockIsConnected: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@/lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: vi.fn(),
  isNodaroConnected: mockIsConnected,
  readNodaroConnectionState: mockState,
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ ai_provider: "kie", cost_markup_percent: 0 })),
  calculateDisplayCost: vi.fn((cost: number, markup: number) => cost * (1 + markup / 100)),
}))

import { registerNodaroCloudProviderWithRetry, NODARO_PROVIDER_ID } from "../index.js"
import { providerRegistry } from "../../registry.js"

const sleeps: number[] = []
const sleep = async (ms: number) => {
  sleeps.push(ms)
}

beforeEach(() => {
  mockState.mockReset()
  mockIsConnected.mockReset()
  sleeps.length = 0
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("registerNodaroCloudProviderWithRetry — before anything is registered", () => {
  it("stops at once on a definitive not-connected (no retry, no registration)", async () => {
    mockState.mockResolvedValue({ state: "not-connected" })
    const attempts: string[] = []
    const registered = await registerNodaroCloudProviderWithRetry({
      delaysMs: [10, 20],
      sleep,
      onAttempt: (s) => attempts.push(s.state),
    })
    expect(registered).toBe(false)
    expect(sleeps).toEqual([])
    expect(attempts).toEqual(["not-connected"])
    expect(providerRegistry.getProvider(NODARO_PROVIDER_ID)).toBeNull()
  })

  it("gives up after the schedule when the store never becomes readable, and says so", async () => {
    mockState.mockResolvedValue({ state: "unavailable", reason: "fetch failed" })
    const registered = await registerNodaroCloudProviderWithRetry({ delaysMs: [10, 20, 40], sleep })
    expect(registered).toBe(false)
    // One attempt per delay plus the initial one.
    expect(mockState).toHaveBeenCalledTimes(4)
    expect(sleeps).toEqual([10, 20, 40])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not read the nodaro.ai connection"))
    expect(providerRegistry.getProvider(NODARO_PROVIDER_ID)).toBeNull()
  })

  it("fires onAttempt after the FIRST attempt even when it will keep retrying", async () => {
    // providersReady() hangs off this: it must not wait for the whole window.
    mockState
      .mockResolvedValueOnce({ state: "unavailable", reason: "fetch failed" })
      .mockResolvedValueOnce({ state: "not-connected" })
    const seen: string[] = []
    await registerNodaroCloudProviderWithRetry({ delaysMs: [5], sleep, onAttempt: (s) => seen.push(s.state) })
    expect(seen[0]).toBe("unavailable")
    expect(seen).toEqual(["unavailable", "not-connected"])
  })
})

describe("registerNodaroCloudProviderWithRetry — registers once the read succeeds", () => {
  it("retries through 'unavailable' and registers when the store reads connected", async () => {
    mockState
      .mockResolvedValueOnce({ state: "unavailable", reason: "fetch failed" })
      .mockResolvedValueOnce({ state: "unavailable", reason: "fetch failed" })
      .mockResolvedValueOnce({
        state: "connected",
        connection: { clientId: "c", clientSecret: "s", accessToken: "t" },
      } as never)
    const registered = await registerNodaroCloudProviderWithRetry({ delaysMs: [10, 20, 40, 80], sleep })
    expect(registered).toBe(true)
    expect(sleeps).toEqual([10, 20])
    expect(providerRegistry.getProvider(NODARO_PROVIDER_ID)).not.toBeNull()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("nodaro.ai cloud connection registered"))
  })

  it("is a no-op once the provider is already registered (self-heal may have won)", async () => {
    mockState.mockResolvedValue({ state: "unavailable", reason: "fetch failed" })
    const registered = await registerNodaroCloudProviderWithRetry({ delaysMs: [10], sleep })
    expect(registered).toBe(true)
    expect(mockState).not.toHaveBeenCalled()
    expect(sleeps).toEqual([])
  })
})
