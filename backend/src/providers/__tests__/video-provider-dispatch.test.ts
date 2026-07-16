import { describe, it, expect, beforeAll } from "vitest"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_PROVIDERS_REQUIRING_IMAGE,
  resolveVideoProviderForMode,
} from "@nodaro/shared"
import { providerRegistry } from "../registry.js"
import { registerKieProviders } from "../kie/index.js"
import { registerReplicateProviders } from "../replicate/index.js"

/**
 * Dispatch-totality guard — every provider id the video routes' Zod enums
 * accept must be claimable by at least one REGISTERED provider, using the
 * registry's real `supportsModel` predicate (the exact check `routeAndExecute`
 * walks). A model that passes route validation but no registration fails every
 * run with "not supported by any registered provider".
 *
 * This is the test class that would have caught kling-3-omni: #2307 added it
 * to the Replicate provider configs + shared enums, #2439 rewrote
 * `replicateInfo` and silently dropped the video registration — the model then
 * hard-failed 100% of runs for ~9 weeks (live-probed 2026-07-16) while still
 * being offered by the picker, the catalog, and the routes.
 */
beforeAll(() => {
  registerKieProviders()
  registerReplicateProviders()
})

function dispatchable(capability: "image-to-video" | "text-to-video", model: string): boolean {
  return providerRegistry
    .listProviders()
    .some((p) => providerRegistry.supportsModel(p.id, capability, model))
}

describe("video provider dispatch totality", () => {
  it("every IMAGE_TO_VIDEO_PROVIDERS member dispatches to a registered provider", () => {
    for (const id of IMAGE_TO_VIDEO_PROVIDERS) {
      const resolved = resolveVideoProviderForMode(id, "image-to-video")
      expect(
        dispatchable("image-to-video", resolved),
        `${id} (resolved: ${resolved}) is offered by the i2v route but NO registered provider claims it — every run would fail at the router`,
      ).toBe(true)
    }
  })

  it("every TEXT_TO_VIDEO_PROVIDERS member dispatches OR is a gated i2v-only id", () => {
    for (const id of TEXT_TO_VIDEO_PROVIDERS) {
      const resolved = resolveVideoProviderForMode(id, "text-to-video")
      // i2v-only ids sit in the t2v enum solely so the route can return the
      // friendly "requires an input image" 400 — they never reach the router.
      if (VIDEO_PROVIDERS_REQUIRING_IMAGE.has(resolved)) continue
      expect(
        dispatchable("text-to-video", resolved),
        `${id} (resolved: ${resolved}) is offered by the t2v route but NO registered provider claims it — every run would fail at the router`,
      ).toBe(true)
    }
  })
})
