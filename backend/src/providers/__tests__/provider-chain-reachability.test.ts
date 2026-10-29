/**
 * Chain-reachability guard — the half `video-provider-dispatch.test.ts` cannot
 * see. That guard proves every offered video id is REGISTERED with some
 * provider; this one proves the router's CHAIN for that capability reaches
 * the provider that registered it. The two are different questions: Replicate
 * registered kling-3-omni for image-to-video, so the registration guard
 * passed, while `buildRoutingDecision("image-to-video")` answered `["kie"]`
 * and the walker never asked Replicate — every run failed with "not supported
 * for image-to-video by any registered provider" (prod 2026-10-29).
 *
 * Totality: for every registered provider and every capability it declares at
 * least one model for, the chain built for that capability must include it.
 * A new Replicate-only model on a capability the chain leaves out fails here,
 * before it ships offered-but-unrunnable.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import type { ProviderCapability } from "../provider.interface.js"
import { providerRegistry } from "../registry.js"
import { registerKieProviders } from "../kie/index.js"
import { registerReplicateProviders } from "../replicate/index.js"

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ ai_provider: "kie", cost_markup_percent: 0, nodaro_provider_prefs: null })),
  calculateDisplayCost: vi.fn((cost: number, markup: number) => cost * (1 + markup / 100)),
}))

import { buildRoutingDecision } from "../config.js"

beforeAll(() => {
  registerKieProviders()
  registerReplicateProviders()
})

describe("provider chain reachability", () => {
  it("every capability a registered provider declares models for has that provider in its chain", async () => {
    const misses: string[] = []
    for (const info of providerRegistry.listProviders()) {
      for (const [capability, models] of Object.entries(info.supportedModels) as Array<[ProviderCapability, readonly string[] | undefined]>) {
        if (!models?.length) continue
        const decision = await buildRoutingDecision(capability, models[0]!)
        if (!decision.providerChain.includes(info.id as (typeof decision.providerChain)[number])) {
          misses.push(`${info.id} declares ${models.length} model(s) for ${capability} (e.g. ${models[0]}) but the chain is [${decision.providerChain.join(", ")}]`)
        }
      }
    }
    expect(misses, misses.join("\n")).toEqual([])
  })

  it("kling-3-omni on image-to-video is served through the real chain, by Replicate, after KIE declines", async () => {
    const decision = await buildRoutingDecision("image-to-video", "kling-3-omni")
    const server = decision.providerChain.find((id) => providerRegistry.supportsModel(id, "image-to-video", "kling-3-omni"))
    expect(server).toBe("replicate")
    // KIE ids keep KIE: the walker takes the first provider that declares the id.
    const kie = await buildRoutingDecision("image-to-video", "minimax")
    expect(kie.providerChain.find((id) => providerRegistry.supportsModel(id, "image-to-video", "minimax"))).toBe("kie")
  })
})
