import { describe, it, expect, afterEach } from "vitest"
import {
  isNodeDenied,
  findDeniedNodeTypes,
  deniedNodeRejectionMessage,
  isModelDenied,
  filterDeniedModels,
  effectiveDeniedNodeTypes,
  effectiveDeniedModelIds,
  nodesHiddenFromUsers,
  USER_VIEWER,
  ADMIN_VIEWER,
} from "../surface-deny.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { __resetModelSwitchForTests } from "../model-switch.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  __resetModelSwitchForTests()
})

describe("surface-deny — node deny reads the profile", () => {
  it("denies nothing by default", () => {
    expect(isNodeDenied("social-publish", USER_VIEWER)).toBe(false)
    expect(findDeniedNodeTypes([{ type: "social-publish" }], USER_VIEWER)).toEqual([])
  })

  it("denies the profile's nodes.deny (requires __resetSurfaceProfileCacheForTests)", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["social-publish"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("social-publish", USER_VIEWER)).toBe(true)
    expect(findDeniedNodeTypes([{ type: "social-publish" }, { type: "generate-image" }], USER_VIEWER)).toEqual([
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
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("generate-video", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("suno-generate", USER_VIEWER)).toBe(true)
  })

  it("inversion is scoped to the gateable universe: utility nodes and unknown pseudo-types are never denied by omission", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    // sticky-note/preview are registry "utility" — exempt from inversion.
    expect(GATEABLE_NODE_TYPES.has("sticky-note")).toBe(false)
    expect(isNodeDenied("sticky-note", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("preview", USER_VIEWER)).toBe(false)
    // A workflow-internal pseudo-type the registry never heard of.
    expect(isNodeDenied("node_7_iter_0", USER_VIEWER)).toBe(false)
  })

  it("deny still applies on top of allow (deny wins), and explicit deny can hit utility nodes", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      nodes: { allow: ["generate-image", "generate-video"], deny: ["generate-video", "sticky-note"] },
    })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("generate-video", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("sticky-note", USER_VIEWER)).toBe(true)
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
    expect(isNodeDenied("generate-video", USER_VIEWER)).toBe(false)
    // …and factory-allowed types not in the override are now denied.
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(true)
    // Utility exemption holds under an override too.
    expect(isNodeDenied("sticky-note", USER_VIEWER)).toBe(false)
  })

  it("Site Capture is never hidden by an override saved without it: the live capture_site tool asks the same predicate", () => {
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image"]) })
    expect(GATEABLE_NODE_TYPES.has("site-capture")).toBe(false)
    expect(isNodeDenied("site-capture", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("generate-video", USER_VIEWER)).toBe(true)
    // An explicit profile deny still removes it.
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["site-capture"] } })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests()
    expect(isNodeDenied("site-capture", USER_VIEWER)).toBe(true)
  })

  it("reset to factory (override null) falls back to the profile layer", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-video"]) })
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(true)
    __resetAvailabilityOverridesForTests({ nodes: null })
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(false)
  })

  it("model override mirrors node semantics", () => {
    __resetAvailabilityOverridesForTests({ models: new Set(["flux"]) })
    expect(isModelDenied("flux")).toBe(false)
    expect(isModelDenied("kling")).toBe(true)
    expect(isModelDenied("not-in-any-universe")).toBe(false)
  })
})

// ── Layer 4: the admin's model switch (model_pricing.is_enabled) ────────────

describe("surface-deny — a model switched off on its pricing row is not offered", () => {
  it("wins over the profile and over an override that lists it", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { allow: ["flux", "flux-flex"] } })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ models: new Set(["flux", "flux-flex"]) })
    __resetModelSwitchForTests(["flux-flex"])
    expect(isModelDenied("flux-flex")).toBe(true)
    expect(isModelDenied("flux")).toBe(false)
    expect(filterDeniedModels([{ id: "flux" }, { id: "flux-flex" }])).toEqual([{ id: "flux" }])
  })

  it("is exact by identifier: a switched-off variant row hides neither its model nor anything else", () => {
    __resetModelSwitchForTests(["flux-flex:2K"])
    expect(isModelDenied("flux-flex")).toBe(false)
    expect(isModelDenied("flux-flex:2K")).toBe(true)
  })

  it("is listed in the effective denied set the browser mirrors, with the switch's own ids", () => {
    __resetModelSwitchForTests(["flux-flex", "flux-flex:2K"])
    const denied = effectiveDeniedModelIds()
    expect(denied).toContain("flux-flex")
    expect(denied).toContain("flux-flex:2K")
    expect(denied).not.toContain("flux")
  })

  it("switched back on, the model is offered again", () => {
    __resetModelSwitchForTests(["flux-flex"])
    expect(isModelDenied("flux-flex")).toBe(true)
    __resetModelSwitchForTests([])
    expect(isModelDenied("flux-flex")).toBe(false)
  })
})

// ── Admin viewer: the admin switch hides a node from USERS, not from admins ──

describe("surface-deny — the admin switch hides a node from users, not from admins", () => {
  it("an admin keeps a node the override turned off; a user does not", () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image"]) })
    expect(isNodeDenied("instagram-scrape", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("instagram-scrape", ADMIN_VIEWER)).toBe(false)
    // A node the override leaves on reads the same for both.
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("generate-image", ADMIN_VIEWER)).toBe(false)
  })

  it("an admin does NOT get back what the deployment profile itself removed (no override)", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["social-publish"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("social-publish", ADMIN_VIEWER)).toBe(true)

    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("generate-video", ADMIN_VIEWER)).toBe(true)
    expect(isNodeDenied("generate-image", ADMIN_VIEWER)).toBe(false)
  })

  it("under an override an admin gets the FACTORY set back — never more than the deployment offers", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      nodes: { allow: ["generate-image", "generate-video"], deny: ["generate-video"] },
    })
    __resetSurfaceProfileCacheForTests()
    __resetAvailabilityOverridesForTests({ nodes: new Set(["text-prompt"]) })
    // Hidden by the override, offered by the factory → the admin keeps it.
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("generate-image", ADMIN_VIEWER)).toBe(false)
    // Hidden by the override AND removed by the factory (deny wins) → stays removed.
    expect(isNodeDenied("generate-video", ADMIN_VIEWER)).toBe(true)
    // Hidden by the override AND never whitelisted by the factory → stays removed.
    expect(isNodeDenied("suno-generate", ADMIN_VIEWER)).toBe(true)
    // Enabled by the override although the factory never listed it → on for everyone.
    expect(isNodeDenied("text-prompt", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("text-prompt", ADMIN_VIEWER)).toBe(false)
  })

  it("the list helpers follow the viewer", () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image"]) })
    const nodes = [{ type: "instagram-scrape" }, { type: "generate-image" }]
    expect(findDeniedNodeTypes(nodes, USER_VIEWER)).toEqual(["instagram-scrape"])
    expect(findDeniedNodeTypes(nodes, ADMIN_VIEWER)).toEqual([])
    expect(effectiveDeniedNodeTypes(USER_VIEWER)).toContain("instagram-scrape")
    expect(effectiveDeniedNodeTypes(ADMIN_VIEWER)).not.toContain("instagram-scrape")
  })

  it("nodesHiddenFromUsers is exactly what an admin can use and a user cannot", () => {
    expect(nodesHiddenFromUsers()).toEqual([])

    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["generate-video"] } })
    __resetSurfaceProfileCacheForTests()
    const everythingBut = (...off: string[]) => new Set([...GATEABLE_NODE_TYPES].filter((t) => !off.includes(t)))
    __resetAvailabilityOverridesForTests({ nodes: everythingBut("instagram-scrape", "meta-ads-scrape", "generate-video") })
    // generate-video is off for the admin too (the profile removed it), so it is not "hidden from users" — it is gone.
    expect(nodesHiddenFromUsers().sort()).toEqual(["instagram-scrape", "meta-ads-scrape"])
  })

  it("the model lever is untouched: no viewer, no admin exception", () => {
    __resetAvailabilityOverridesForTests({ models: new Set(["flux"]) })
    expect(isModelDenied("kling")).toBe(true)
  })
})
