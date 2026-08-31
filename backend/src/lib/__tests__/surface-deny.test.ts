import { describe, it, expect, afterEach } from "vitest"
import {
  isNodeDenied,
  findDeniedNodeTypes,
  deniedNodeRejectionMessage,
  isModelDenied,
  filterDeniedModels,
} from "../surface-deny.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("surface-deny — node deny reads the profile", () => {
  it("denies nothing by default", () => {
    expect(isNodeDenied("social-publish")).toBe(false)
    expect(findDeniedNodeTypes([{ type: "social-publish" }])).toEqual([])
  })

  it("denies the profile's nodes.deny (requires __resetSurfaceProfileCacheForTests)", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["social-publish"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("social-publish")).toBe(true)
    expect(findDeniedNodeTypes([{ type: "social-publish" }, { type: "generate-image" }])).toEqual([
      "social-publish",
    ])
  })

  it("message names the denied types", () => {
    expect(deniedNodeRejectionMessage(["social-publish"])).toMatch(/social-publish/)
  })
})

describe("surface-deny — model deny reads the profile", () => {
  it("denies nothing by default", () => {
    expect(isModelDenied("veo3")).toBe(false)
    expect(filterDeniedModels([{ id: "veo3" }, { id: "flux" }])).toEqual([{ id: "veo3" }, { id: "flux" }])
  })

  it("denies the profile's models.deny", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["veo3"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isModelDenied("veo3")).toBe(true)
    expect(filterDeniedModels([{ id: "veo3" }, { id: "flux" }])).toEqual([{ id: "flux" }])
  })
})

// ── B5: three-layer availability (factory allow + admin override) ───────────

import { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, GATEABLE_NODE_TYPES, GATEABLE_MODEL_IDS } from "../availability-override.js"

import { beforeAll } from "vitest"
beforeAll(() => __availabilityUniverseReadyForTests())

afterEach(() => __resetAvailabilityOverridesForTests())

describe("surface-deny — profile allow whitelist (factory layer)", () => {
  it("a non-empty nodes.allow denies unlisted GATEABLE types and keeps listed ones", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image", "text-prompt"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("generate-image")).toBe(false)
    expect(isNodeDenied("generate-video")).toBe(true)
    expect(isNodeDenied("suno-generate")).toBe(true)
  })

  it("inversion is scoped to the gateable universe: utility nodes and unknown pseudo-types are never denied by omission", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    // sticky-note/preview are registry "utility" — exempt from inversion.
    expect(GATEABLE_NODE_TYPES.has("sticky-note")).toBe(false)
    expect(isNodeDenied("sticky-note")).toBe(false)
    expect(isNodeDenied("preview")).toBe(false)
    // A workflow-internal pseudo-type the registry never heard of.
    expect(isNodeDenied("node_7_iter_0")).toBe(false)
  })

  it("deny still applies on top of allow (deny wins), and explicit deny can hit utility nodes", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      nodes: { allow: ["generate-image", "generate-video"], deny: ["generate-video", "sticky-note"] },
    })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("generate-image")).toBe(false)
    expect(isNodeDenied("generate-video")).toBe(true)
    expect(isNodeDenied("sticky-note")).toBe(true)
  })

  it("models.allow mirrors the node semantics over the model universe", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { allow: ["flux", "veo3"] } })
    __resetSurfaceProfileCacheForTests()
    expect(GATEABLE_MODEL_IDS.has("flux")).toBe(true)
    expect(isModelDenied("flux")).toBe(false)
    expect(isModelDenied("kling")).toBe(true)
    // A composite/unknown id is not in the universe — never denied by omission.
    expect(isModelDenied("gpt-image:high")).toBe(false)
    expect(filterDeniedModels([{ id: "flux" }, { id: "kling" }])).toEqual([{ id: "flux" }])
  })
})

describe("surface-deny — admin override REPLACES the factory layer", () => {
  it("an override set wins over both profile allow and deny", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      nodes: { allow: ["generate-image"], deny: ["generate-video"] },
    })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-video"]) })
    // Enabled by the override even though factory denies it…
    expect(isNodeDenied("generate-video")).toBe(false)
    // …and factory-allowed types not in the override are now denied.
    expect(isNodeDenied("generate-image")).toBe(true)
    // Utility exemption holds under an override too.
    expect(isNodeDenied("sticky-note")).toBe(false)
  })

  it("reset to factory (override null) falls back to the profile layer", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-video"]) })
    expect(isNodeDenied("generate-image")).toBe(true)
    __resetAvailabilityOverridesForTests({ nodes: null })
    expect(isNodeDenied("generate-image")).toBe(false)
  })

  it("model override mirrors node semantics", () => {
    __resetAvailabilityOverridesForTests({ models: new Set(["flux"]) })
    expect(isModelDenied("flux")).toBe(false)
    expect(isModelDenied("kling")).toBe(true)
    expect(isModelDenied("not-in-any-universe")).toBe(false)
  })
})
