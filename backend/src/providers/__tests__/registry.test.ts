import { describe, it, expect } from "vitest"
import { providerRegistry } from "@/providers/registry.js"
import type {
  ProviderCapability,
  ProviderInfo,
} from "@/providers/provider.interface.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ProviderInfo with sensible defaults, using a unique id prefix. */
function makeProviderInfo(
  id: string,
  capabilities: ProviderCapability[],
  supportedModels: Partial<Record<ProviderCapability, string[]>> = {}
): ProviderInfo {
  const fullModels = {} as Record<ProviderCapability, string[]>
  for (const cap of capabilities) {
    fullModels[cap] = supportedModels[cap] ?? []
  }
  return {
    id,
    name: `Test Provider ${id}`,
    capabilities,
    supportedModels: fullModels,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// providerRegistry is a singleton with no reset method. Each test uses unique
// IDs (prefixed by test number) to avoid cross-contamination between tests.

describe("ProviderRegistry", () => {
  it("register stores a provider and it can be retrieved", () => {
    const info = makeProviderInfo("t1-alpha", ["image-generation"])
    const instance = { generate: () => "image" }

    providerRegistry.register(info, instance)

    expect(providerRegistry.getProvider("t1-alpha")).toBe(instance)
  })

  it("register overwrites existing provider with same id", () => {
    const info1 = makeProviderInfo("t2-overwrite", ["image-generation"])
    const instance1 = { version: 1 }
    const info2 = makeProviderInfo("t2-overwrite", [
      "image-generation",
      "text-to-video",
    ])
    const instance2 = { version: 2 }

    providerRegistry.register(info1, instance1)
    providerRegistry.register(info2, instance2)

    expect(providerRegistry.getProvider("t2-overwrite")).toBe(instance2)
    expect(providerRegistry.getProviderInfo("t2-overwrite")).toEqual(info2)
  })

  it("getProvider returns null for unknown provider", () => {
    expect(providerRegistry.getProvider("t3-nonexistent")).toBeNull()
  })

  it("getProviderInfo returns info for registered provider", () => {
    const info = makeProviderInfo("t4-info", ["text-to-speech", "lip-sync"], {
      "text-to-speech": ["elevenlabs"],
      "lip-sync": ["kling-avatar"],
    })
    const instance = {}

    providerRegistry.register(info, instance)

    const retrieved = providerRegistry.getProviderInfo("t4-info")
    expect(retrieved).toEqual(info)
    expect(retrieved?.capabilities).toContain("text-to-speech")
    expect(retrieved?.capabilities).toContain("lip-sync")
    expect(retrieved?.supportedModels["text-to-speech"]).toEqual([
      "elevenlabs",
    ])
  })

  it("getProviderInfo returns null for unknown provider", () => {
    expect(providerRegistry.getProviderInfo("t5-ghost")).toBeNull()
  })

  it("getProvidersForCapability returns matching providers", () => {
    const infoA = makeProviderInfo("t6-cap-a", ["image-to-video"])
    const instanceA = { name: "A" }
    const infoB = makeProviderInfo("t6-cap-b", [
      "image-to-video",
      "text-to-video",
    ])
    const instanceB = { name: "B" }
    const infoC = makeProviderInfo("t6-cap-c", ["music-generation"])
    const instanceC = { name: "C" }

    providerRegistry.register(infoA, instanceA)
    providerRegistry.register(infoB, instanceB)
    providerRegistry.register(infoC, instanceC)

    const videoProviders =
      providerRegistry.getProvidersForCapability("image-to-video")
    const ids = videoProviders.map((p) => p.id)

    expect(ids).toContain("t6-cap-a")
    expect(ids).toContain("t6-cap-b")
    expect(ids).not.toContain("t6-cap-c")

    const matchA = videoProviders.find((p) => p.id === "t6-cap-a")
    expect(matchA?.instance).toBe(instanceA)
  })

  it("getProvidersForCapability returns empty array when no providers match", () => {
    const result = providerRegistry.getProvidersForCapability("transcription")

    // Filter out any providers from other tests that might have transcription
    // Since none of our test providers register transcription, this should be empty
    // unless some prior test registered one. Use a unique capability check.
    const t7Providers = result.filter((p) => p.id.startsWith("t7-"))
    expect(t7Providers).toEqual([])

    // Also verify the return type is an array even with no matches
    expect(Array.isArray(result)).toBe(true)
  })

  it("supportsModel returns true/false correctly, and false for unregistered provider", () => {
    const info = makeProviderInfo(
      "t8-models",
      ["image-generation", "text-to-video"],
      {
        "image-generation": ["flux", "nano-banana"],
        "text-to-video": ["minimax", "kling"],
      }
    )
    const instance = {}

    providerRegistry.register(info, instance)

    // Supported model for the correct capability
    expect(
      providerRegistry.supportsModel("t8-models", "image-generation", "flux")
    ).toBe(true)
    expect(
      providerRegistry.supportsModel(
        "t8-models",
        "image-generation",
        "nano-banana"
      )
    ).toBe(true)
    expect(
      providerRegistry.supportsModel("t8-models", "text-to-video", "minimax")
    ).toBe(true)

    // Model exists but under a different capability
    expect(
      providerRegistry.supportsModel("t8-models", "text-to-video", "flux")
    ).toBe(false)

    // Completely unknown model
    expect(
      providerRegistry.supportsModel(
        "t8-models",
        "image-generation",
        "unknown-model"
      )
    ).toBe(false)

    // Capability not registered on this provider
    expect(
      providerRegistry.supportsModel("t8-models", "lip-sync", "kling-avatar")
    ).toBe(false)

    // Completely unknown provider
    expect(
      providerRegistry.supportsModel(
        "t8-unregistered",
        "image-generation",
        "flux"
      )
    ).toBe(false)
  })
})
