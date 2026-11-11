/**
 * House-model availability: ONE rule in `isModelDenied` (lib/surface-deny.ts)
 * — a house model this install does not serve is no model here — and what
 * follows from it: the effective denied set the editor reads, recommendations,
 * and the neutral provider name its jobs count against. Against a FAKE plugin
 * service and a catalog with one own-label fixture.
 */
import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/model-catalog")>()
  return {
    ...actual,
    MODEL_CATALOG: {
      ...actual.MODEL_CATALOG,
      "house-fixture": {
        id: "house-fixture", kind: "image", modes: ["upscale"], family: "House Fixture", ownLabel: true,
        label: "House Fixture", series: "House Fixture", description: "A fixture.", useCases: [], pricing: [{ identifier: "house-fixture", credits: 1 }],
      },
    },
  }
})

import { setPluginServices } from "../private-plugins/services-registry.js"
import type { PluginHouseModelsService } from "../private-plugins/types.js"
import { effectiveDeniedModelIds, isHouseModelUnserved, isModelDenied, recommendationsServedHere } from "../surface-deny.js"
import { primaryProviderOfJob } from "../concurrency-lanes/provider-of.js"

function serving(ids: readonly string[]): void {
  const service: PluginHouseModelsService = {
    ids: () => ids,
    plan: () => ({ providerCostUsd: 0 }),
    start: async () => ({ taskRef: "r" }),
    poll: async () => ({ state: "running" }),
  }
  setPluginServices({ houseModels: service })
}

afterEach(() => {
  setPluginServices({})
})

describe("isModelDenied: a house model this install does not serve is no model here", () => {
  it("denied without a plugin service, or when the plugin does not serve it; offered when it does", () => {
    expect(isHouseModelUnserved("house-fixture")).toBe(true)
    expect(isModelDenied("house-fixture")).toBe(true)
    expect(effectiveDeniedModelIds()).toContain("house-fixture")
    serving([])
    expect(isModelDenied("house-fixture")).toBe(true)
    serving(["house-fixture"])
    expect(isHouseModelUnserved("house-fixture")).toBe(false)
    expect(isModelDenied("house-fixture")).toBe(false)
    expect(effectiveDeniedModelIds()).not.toContain("house-fixture")
  })

  it("never touches a model the catalog does not mark own-label, served list or not", () => {
    for (const id of ["z-image", "recraft-upscale", "veo3"]) {
      expect(isHouseModelUnserved(id)).toBe(false)
      serving([id])
      expect(isHouseModelUnserved(id)).toBe(false)
    }
  })
})

describe("recommendationsServedHere", () => {
  const RECS = [
    { intent: "a", modelIds: ["z-image"], note: "" },
    { intent: "b", modelIds: ["house-fixture", "z-image"], note: "" },
    { intent: "c", modelIds: ["house-fixture"], note: "" },
  ]

  it("leaves an unserved house model out of each recommendation and drops one left empty", () => {
    const out = recommendationsServedHere(RECS)
    expect(out.map((r) => [r.intent, r.modelIds])).toEqual([["a", ["z-image"]], ["b", ["z-image"]]])
    expect(out[0]).toBe(RECS[0])
  })

  it("returns every recommendation as it came when the house model is served", () => {
    serving(["house-fixture"])
    const out = recommendationsServedHere(RECS)
    expect(out).toHaveLength(3)
    out.forEach((r, i) => expect(r).toBe(RECS[i]))
  })
})

describe("attribution: a house-model job counts against one neutral name", () => {
  it("whatever the job, served or not", () => {
    expect(primaryProviderOfJob("edit-image", { provider: "house-fixture" })).toBe("house-models")
    serving(["house-fixture"])
    expect(primaryProviderOfJob("edit-image", { provider: "house-fixture" })).toBe("house-models")
  })
})
