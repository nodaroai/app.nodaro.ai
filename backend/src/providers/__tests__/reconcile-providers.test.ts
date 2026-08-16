/**
 * Provider keys are live; the REGISTRY has to follow. initProviders() only
 * registers KIE/Replicate whose key is present at boot — a key that arrives
 * later (pasted on /setup, or loaded from the encrypted store after the boot
 * race) must register the provider, and a cleared key must remove it, without
 * a restart. reconcileProviders() is that hook; providers/index.ts subscribes
 * it to the runtime's change events.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { registerKie, registerReplicate, registerNodaro } = vi.hoisted(() => ({
  registerKie: vi.fn(),
  registerReplicate: vi.fn(),
  registerNodaro: vi.fn(async () => true),
}))

vi.mock("../kie/index.js", () => ({ registerKieProviders: registerKie }))
vi.mock("../replicate/index.js", () => ({ registerReplicateProviders: registerReplicate }))
vi.mock("../nodaro/index.js", () => ({
  NODARO_PROVIDER_ID: "nodaro",
  registerNodaroCloudProviderIfConnected: registerNodaro,
  registerNodaroCloudProviderWithRetry: vi.fn(async () => false),
}))
// providers/index.ts re-exports the router, whose import graph reaches
// lib/supabase.ts — give the client the same stub URL src/test/setup.ts does.
vi.mock("../../lib/config.js", () => ({
  config: {
    KIE_API_KEY: "",
    REPLICATE_API_TOKEN: "",
    NODARO_API_KEY: "",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
  },
}))
// The store is not under test here (it has its own suite); keep this file
// free of Supabase.
vi.mock("../../lib/provider-credentials.js", () => ({
  loadProviderCredentials: vi.fn(async () => undefined),
  refreshProviderCredentialsIfStale: vi.fn(async () => false),
  refreshProviderCredentialsNow: vi.fn(async () => false),
  PROVIDER_CREDENTIALS_TTL_MS: 30_000,
}))

import { providerRegistry } from "../registry.js"
import { reconcileProviders, watchProviderCredentials, PROVIDER_CREDENTIALS_POLL_MS, _resetProviderCredentialsWatchForTests } from "../index.js"
import { refreshProviderCredentialsIfStale, PROVIDER_CREDENTIALS_TTL_MS } from "../../lib/provider-credentials.js"
import { applyAppSnapshot, setEnvProviderKeys, _resetProviderKeysRuntimeForTests } from "../../lib/provider-keys-runtime.js"

const kieInfo = { id: "kie", name: "KIE.ai", capabilities: [], supportedModels: {} } as never
const replicateInfo = { id: "replicate", name: "Replicate", capabilities: [], supportedModels: {} } as never

beforeEach(() => {
  _resetProviderKeysRuntimeForTests()
  _resetProviderCredentialsWatchForTests()
  setEnvProviderKeys({})
  registerKie.mockReset().mockImplementation(() => providerRegistry.register(kieInfo, {}))
  registerReplicate.mockReset().mockImplementation(() => providerRegistry.register(replicateInfo, {}))
  registerNodaro.mockClear()
  providerRegistry.unregister("kie")
  providerRegistry.unregister("replicate")
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("providerRegistry.unregister", () => {
  it("removes a provider so the router stops seeing it", () => {
    providerRegistry.register(kieInfo, {})
    expect(providerRegistry.getProvider("kie")).not.toBeNull()
    providerRegistry.unregister("kie")
    expect(providerRegistry.getProvider("kie")).toBeNull()
    expect(providerRegistry.getProviderInfo("kie")).toBeNull()
  })

  it("is a no-op for an unknown id", () => {
    expect(() => providerRegistry.unregister("nope")).not.toThrow()
  })
})

describe("reconcileProviders", () => {
  it("registers KIE when its key appears (app-managed) and was not registered", async () => {
    applyAppSnapshot({ kie: "kie_from_app" })
    await reconcileProviders(["kie"])
    expect(registerKie).toHaveBeenCalledOnce()
    expect(providerRegistry.getProvider("kie")).not.toBeNull()
  })

  it("does not double-register an already registered provider", async () => {
    setEnvProviderKeys({ kie: "env" })
    providerRegistry.register(kieInfo, {})
    await reconcileProviders(["kie"])
    expect(registerKie).not.toHaveBeenCalled()
  })

  it("unregisters a provider whose key was cleared", async () => {
    setEnvProviderKeys({ replicate: "r8" })
    providerRegistry.register(replicateInfo, {})
    setEnvProviderKeys({})
    await reconcileProviders(["replicate"])
    expect(providerRegistry.getProvider("replicate")).toBeNull()
  })

  it("routes a nodaro key change to the cloud-provider registration", async () => {
    applyAppSnapshot({ nodaro: "ndr_personal" })
    await reconcileProviders(["nodaro"])
    expect(registerNodaro).toHaveBeenCalledOnce()
  })

  it("ignores providers that are not registry providers (direct clients read the live key)", async () => {
    applyAppSnapshot({ anthropic: "an", gemini: "gm", elevenlabs: "el", fal: "fal" })
    await reconcileProviders(["anthropic", "gemini", "elevenlabs", "fal"])
    expect(registerKie).not.toHaveBeenCalled()
    expect(registerReplicate).not.toHaveBeenCalled()
    expect(registerNodaro).not.toHaveBeenCalled()
  })
})

describe("watchProviderCredentials", () => {
  it("polls faster than the TTL so a stale snapshot is re-read within TTL + one tick (no skipped ticks)", async () => {
    // With tick == TTL, a tick landing a few ms before the snapshot turns stale
    // was skipped and the next read slid a whole period out (60 s pickup for a
    // 30 s TTL, seen live 2026-08-16).
    expect(PROVIDER_CREDENTIALS_POLL_MS).toBeLessThanOrEqual(PROVIDER_CREDENTIALS_TTL_MS / 2)
    vi.useFakeTimers()
    try {
      watchProviderCredentials()
      const refresh = vi.mocked(refreshProviderCredentialsIfStale)
      refresh.mockClear()
      await vi.advanceTimersByTimeAsync(PROVIDER_CREDENTIALS_TTL_MS + PROVIDER_CREDENTIALS_POLL_MS)
      expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("subscribes the reconcile so awaiting applyAppSnapshot means the registry already reflects the change", async () => {
    watchProviderCredentials()
    await applyAppSnapshot({ kie: "pasted" })
    expect(providerRegistry.getProvider("kie")).not.toBeNull()
    await applyAppSnapshot({})
    expect(providerRegistry.getProvider("kie")).toBeNull()
  })
})
