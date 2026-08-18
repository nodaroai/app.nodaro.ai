import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Registration used to be one-way: boot (and the router's self-heal) could ADD
// the cloud provider, nothing ever removed it. Disconnecting cleared the TOKEN
// but left the provider registered, so the router still built a non-empty chain,
// selected it, and the cloud client threw a raw "nodaro.ai is not connected" —
// instead of the empty-chain path where describeEmptyCapability says what to
// configure. The stale entry survived until the process restarted (#771).
//
// Only isNodaroConnected is mocked; the registry is the real one, because the
// invariant under test is about the registry's actual contents.
// ---------------------------------------------------------------------------

const { mockIsConnected } = vi.hoisted(() => ({
  mockIsConnected: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@/lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: vi.fn(),
  isNodaroConnected: mockIsConnected,
}))

import {
  NODARO_PROVIDER_ID,
  registerNodaroCloudProviderIfConnected,
  unregisterNodaroCloudProvider,
} from "../index.js"
import { providerRegistry } from "../../registry.js"

const isRegistered = () => providerRegistry.getProvider(NODARO_PROVIDER_ID) !== null

describe("nodaro cloud provider registration is symmetric (#771)", () => {
  beforeEach(() => {
    unregisterNodaroCloudProvider()
    mockIsConnected.mockReset()
  })

  it("unregisters the provider so a disconnected install has no cloud provider left", async () => {
    mockIsConnected.mockResolvedValue(true)
    expect(await registerNodaroCloudProviderIfConnected()).toBe(true)
    expect(isRegistered()).toBe(true)

    unregisterNodaroCloudProvider()

    expect(isRegistered()).toBe(false)
  })

  it("does not re-register once the token is gone — the self-heal gate must stay shut", async () => {
    mockIsConnected.mockResolvedValue(true)
    await registerNodaroCloudProviderIfConnected()
    unregisterNodaroCloudProvider()

    // What the router's self-heal calls on the next job after a disconnect.
    mockIsConnected.mockResolvedValue(false)
    expect(await registerNodaroCloudProviderIfConnected()).toBe(false)

    expect(isRegistered()).toBe(false)
  })

  it("is a no-op when nothing is registered, so a repeated disconnect cannot throw", () => {
    expect(isRegistered()).toBe(false)
    expect(() => {
      unregisterNodaroCloudProvider()
      unregisterNodaroCloudProvider()
    }).not.toThrow()
    expect(isRegistered()).toBe(false)
  })

  it("re-registers cleanly on reconnect", async () => {
    mockIsConnected.mockResolvedValue(true)
    await registerNodaroCloudProviderIfConnected()
    unregisterNodaroCloudProvider()
    expect(isRegistered()).toBe(false)

    expect(await registerNodaroCloudProviderIfConnected()).toBe(true)
    expect(isRegistered()).toBe(true)
  })
})
